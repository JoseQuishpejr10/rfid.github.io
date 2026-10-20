let datosGlobales = { unicas: [], auditoria: [], historial: [], total_unicas: 0, total_lecturas_hechas: 0, total_repetidas: 0, estado: 'activo' };

let filtroPrincipal = { columna: null, orden: 'asc', texto: '' };
let filtroAuditoria = { columna: null, orden: 'asc', texto: '' };
let tablaActivaMenu = null;
let columnaActivaMenu = null;
let sesionSeleccionadaId = null;

function cambiarVista(vista, elemento) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));
  
  document.getElementById(`view-${vista}`).classList.add('active');
  elemento.classList.add('active');

  if (vista === 'historial') {
    renderizarHistorial();
  }
}

async function cambiarEstado(accion) {
  try {
    const respuesta = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: accion })
    });
    const resultado = await respuesta.json();
    actualizarInterfazEstado(resultado.estado);

    if (resultado.estado === 'detenido') {
      generarReporte();
    }
  } catch (error) {
    console.error("Error al cambiar estado:", error);
  }
}

async function togglePuerto(puerto, activo) {
  try {
    const res = await fetch('/api/ura4/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puerto: puerto, activo: activo, potencia: 30 })
    });
    const data = await res.json();
    if (data.status === 'success') {
      console.log(`[URA4] ${puerto} configurado a: ${activo ? 'ACTIVO' : 'INACTIVO'}`);
    }
  } catch (e) {
    console.error("Error enviando configuración de puerto URA4:", e);
  }
}

function actualizarInterfazEstado(estado) {
  datosGlobales.estado = estado;
  const badge = document.getElementById('badge-estado');
  const dot = document.getElementById('dot-estado');
  const txt = document.getElementById('txt-estado');

  const btnIniciar = document.getElementById('btn-iniciar');
  const txtIniciar = document.getElementById('txt-iniciar');
  const iconIniciar = document.getElementById('icon-iniciar');

  const btnPausar = document.getElementById('btn-pausar');
  const txtPausar = document.getElementById('txt-pausar');
  const iconPausar = document.getElementById('icon-pausar');

  if (estado === 'activo') {
    badge.className = 'status-badge status-active';
    dot.style.background = 'var(--success)';
    txt.textContent = 'Activo';

    btnIniciar.style.filter = 'brightness(1.15)';
    btnIniciar.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.4)';
    iconIniciar.className = 'fa-solid fa-circle-check';
    txtIniciar.textContent = 'Iniciado';

    btnPausar.style.filter = 'none';
    btnPausar.style.boxShadow = 'none';
    iconPausar.className = 'fa-solid fa-pause';
    txtPausar.textContent = 'Pausar';

  } else if (estado === 'pausado') {
    badge.className = 'status-badge';
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';
    badge.style.border = '1px solid #fde68a';
    dot.style.background = '#f59e0b';
    txt.textContent = 'Pausado';

    btnIniciar.style.filter = 'none';
    btnIniciar.style.boxShadow = 'none';
    iconIniciar.className = 'fa-solid fa-play';
    txtIniciar.textContent = 'Iniciar';

    btnPausar.style.filter = 'brightness(1.15)';
    btnPausar.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.4)';
    iconPausar.className = 'fa-solid fa-circle-exclamation';
    txtPausar.textContent = 'Pausado';

  } else if (estado === 'detenido') {
    badge.className = 'status-badge status-stopped';
    dot.style.background = 'var(--danger)';
    txt.textContent = 'Detenido';

    btnIniciar.style.filter = 'none';
    btnIniciar.style.boxShadow = 'none';
    iconIniciar.className = 'fa-solid fa-play';
    txtIniciar.textContent = 'Iniciar';

    btnPausar.style.filter = 'none';
    btnPausar.style.boxShadow = 'none';
    iconPausar.className = 'fa-solid fa-pause';
    txtPausar.textContent = 'Pausar';
  }
}

async function guardarSesionActual() {
  if (datosGlobales.unicas.length === 0) {
    alert("No hay lecturas en vivo para guardar.");
    return;
  }
  try {
    const res = await fetch('/api/guardar-sesion', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      alert(data.mensaje);
      actualizarLecturas();
    } else {
      alert("Error al guardar: " + (data.message || "Desconocido"));
    }
  } catch (e) {
    console.error("Error de conexión:", e);
    alert("Error de conexión con el servidor Flask.");
  }
}

async function actualizarLecturas() {
  try {
    let url = '/api/lecturas';
    if (filtroPrincipal.columna) {
      url += `?columna=${filtroPrincipal.columna}&orden=${filtroPrincipal.orden}`;
    }

    const respuesta = await fetch(url);
    datosGlobales = await respuesta.json();
    
    actualizarInterfazEstado(datosGlobales.estado);
    document.getElementById('metric-unique').textContent = datosGlobales.total_unicas;
    document.getElementById('metric-total-lecturas').textContent = datosGlobales.total_lecturas_hechas;
    document.getElementById('metric-repetidas').textContent = datosGlobales.total_repetidas;

    if (datosGlobales.unicas.length > 0) {
      document.getElementById('metric-last-time').textContent = datosGlobales.unicas[0].hora;
    }

    renderizarTablaPrincipal();
    if (document.getElementById('modal-repetidas-detalle').style.display === 'flex') {
      renderizarTablaAuditoria();
    }

    if (document.getElementById('view-historial').classList.contains('active')) {
      renderizarHistorial();
    }

  } catch (error) {
    console.error("Error consultando API:", error);
  }
}

function renderizarTablaPrincipal() {
  const tbody = document.getElementById('tabla-lecturas');
  let lista = [...datosGlobales.unicas];

  if (filtroPrincipal.texto) {
    lista = lista.filter(item => {
      const val = String(item[filtroPrincipal.columna] || '').toLowerCase();
      return val.includes(filtroPrincipal.texto);
    });
  }
  
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No se encontraron registros activos.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((item, index) => {
    const esNoDisponible = item.estado_disponibilidad && item.estado_disponibilidad.includes('No Disponible');
    const badgeEstilo = esNoDisponible 
      ? 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;' 
      : 'background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0;';
    
    return `
      <tr style="${esNoDisponible ? 'background-color: rgba(254, 226, 226, 0.25);' : ''}">
        <td><strong>#${index + 1}</strong></td>
        <td><i class="fa-regular fa-clock" style="color: var(--text-muted); margin-right: 6px;"></i> ${item.hora}</td>
        <td><span style="font-weight: 600; color: var(--primary);">${item.reader_id}</span></td>
        <td><span class="channel-badge">${item.canal}</span></td>
        <td><span class="tag-name">${item.contenido}</span></td>
        <td style="text-align: center;"><span class="channel-badge" style="${badgeEstilo}">${item.estado_disponibilidad || 'Disponible'}</span></td>
        <td style="text-align: center;"><span class="repeat-badge">${item.repeticiones}</span></td>
      </tr>
    `;
  }).join('');
}

function renderizarHistorial() {
  const tbody = document.getElementById('tabla-historial');
  const historial = datosGlobales.historial || [];

  if (historial.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No hay sesiones guardadas todavía en SQL Server.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = historial.map(sesion => `
    <tr>
      <td><strong>#${sesion.id}</strong></td>
      <td><i class="fa-regular fa-calendar" style="margin-right: 6px;"></i> ${sesion.fecha}</td>
      <td style="text-align: center;"><span class="channel-badge" style="background: #e0e7ff; color: #3730a3;">${sesion.total_unicas} únicas</span></td>
      <td style="text-align: center;"><span class="channel-badge">${sesion.total_lecturas} lecturas</span></td>
      <td style="text-align: center;">
        <button class="btn btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;" onclick="verSesion(${sesion.id})">
          <i class="fa-solid fa-eye"></i> Ver
        </button>
        <button class="btn btn-success" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; margin-left: 4px;" onclick="exportarSesionExcel(${sesion.id})">
          <i class="fa-solid fa-file-excel"></i> Excel
        </button>
        <button class="btn btn-danger" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; margin-left: 4px;" onclick="exportarSesionPDF(${sesion.id})">
          <i class="fa-solid fa-file-pdf"></i> PDF
        </button>
      </td>
    </tr>
  `).join('');
}

function verSesion(idSesion) {
  const sesion = datosGlobales.historial.find(s => s.id === idSesion);
  if (!sesion) return;

  sesionSeleccionadaId = idSesion;
  document.getElementById('titulo-modal-sesion').innerHTML = `<i class="fa-solid fa-eye" style="color: var(--primary);"></i> Detalle de Sesión Guardada #${sesion.id} (${sesion.fecha})`;

  const tbody = document.getElementById('tabla-sesion-detalle');
  tbody.innerHTML = sesion.unicas.map((item, index) => `
    <tr>
      <td><strong>#${index + 1}</strong></td>
      <td><i class="fa-regular fa-clock" style="color: var(--text-muted); margin-right: 4px;"></i> ${item.hora}</td>
      <td><span style="font-weight: 600; color: var(--primary);">${item.reader_id}</span></td>
      <td><span class="channel-badge">${item.canal}</span></td>
      <td><span class="tag-name">${item.contenido}</span></td>
      <td style="text-align: center;"><span class="repeat-badge">${item.repeticiones}</span></td>
    </tr>
  `).join('');

  document.getElementById('modal-ver-sesion').style.display = 'flex';
}

function cerrarModalSesion() {
  document.getElementById('modal-ver-sesion').style.display = 'none';
}

function exportarSesionDesdeModalExcel() {
  if (sesionSeleccionadaId) exportarSesionExcel(sesionSeleccionadaId);
}

function exportarSesionDesdeModalPDF() {
  if (sesionSeleccionadaId) exportarSesionPDF(sesionSeleccionadaId);
}

function exportarSesionExcel(idSesion) {
  const sesion = datosGlobales.historial.find(s => s.id === idSesion);
  if (!sesion) return;

  const wb = XLSX.utils.book_new();

  const datosExcel = sesion.unicas.map((item, index) => ({
    "Índice": index + 1,
    "Última Hora": item.hora,
    "Dispositivo": item.reader_id,
    "Canal": item.canal,
    "Contenido / Carga EPC": item.contenido,
    "Veces Repetida": item.repeticiones
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datosExcel), "Inventario Único");

  const datosAuditoria = sesion.auditoria.map((item, index) => ({
    "Índice": index + 1,
    "Hora": item.hora,
    "Canal": item.canal,
    "Contenido": item.contenido,
    "Código EPC": item.epc,
    "Veces Repetida": item.repeticiones
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datosAuditoria), "Auditoría Detallada");

  XLSX.writeFile(wb, `Reporte_RFID_Sesion_${sesion.id}_${sesion.fecha.slice(0,10)}.xlsx`);
}

function exportarSesionPDF(idSesion) {
  const sesion = datosGlobales.historial.find(s => s.id === idSesion);
  if (!sesion) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Reporte de Inventario RFID - Chainway URA4", 14, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Sesión ID: #${sesion.id} | Fecha: ${sesion.fecha}`, 14, 28);
  doc.text(`Total Únicas: ${sesion.total_unicas} | Total Lecturas: ${sesion.total_lecturas}`, 14, 34);

  const columnas = ["Índice", "Hora", "Canal", "Contenido / Nombre", "Repeticiones"];
  const filas = sesion.unicas.map((item, index) => [
    index + 1,
    item.hora,
    item.canal,
    item.contenido,
    item.repeticiones
  ]);

  doc.autoTable({
    head: [columnas],
    body: filas,
    startY: 42,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] }
  });

  doc.save(`Reporte_RFID_Sesion_${sesion.id}.pdf`);
}

function renderizarTablaAuditoria() {
  const tbodyAuditoria = document.getElementById('tabla-repetidas-detalle');
  let lista = [...datosGlobales.auditoria];

  if (filtroAuditoria.columna) {
    lista.sort((a, b) => {
      let valA = a[filtroAuditoria.columna];
      let valB = b[filtroAuditoria.columna];
      if (filtroAuditoria.columna === 'repeticiones') {
        valA = Number(valA); valB = Number(valB);
      } else {
        valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
      }
      if (valA < valB) return filtroAuditoria.orden === 'asc' ? -1 : 1;
      if (valA > valB) return filtroAuditoria.orden === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (filtroAuditoria.texto) {
    lista = lista.filter(item => {
      const val = String(item[filtroAuditoria.columna] || '').toLowerCase();
      return val.includes(filtroAuditoria.texto);
    });
  }
  
  if (lista.length === 0) {
    tbodyAuditoria.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay registros coincidentes.</td></tr>`;
    return;
  }

  tbodyAuditoria.innerHTML = lista.map(item => `
    <tr>
      <td><i class="fa-regular fa-clock" style="color: var(--text-muted); margin-right: 6px;"></i> ${item.hora}</td>
      <td><span class="channel-badge">${item.canal}</span></td>
      <td><strong>${item.contenido}</strong></td>
      <td style="text-align: center;"><span class="repeat-badge">${item.repeticiones}</span></td>
    </tr>
  `).join('');
}

function toggleMenuFiltro(event, columna, tabla) {
  event.stopPropagation();
  const menu = document.getElementById('excel-filter-menu');
  
  tablaActivaMenu = tabla;
  columnaActivaMenu = columna;

  document.getElementById('menu-title').textContent = `Filtro: ${columna.toUpperCase()}`;
  document.getElementById('excel-search-input').value = (tabla === 'principal' ? filtroPrincipal.texto : filtroAuditoria.texto);

  const rect = event.target.getBoundingClientRect();
  menu.style.top = `${window.scrollY + rect.bottom + 6}px`;
  menu.style.left = `${window.scrollX + rect.left}px`;
  menu.style.display = 'block';
}

window.onclick = function(event) {
  const menu = document.getElementById('excel-filter-menu');
  if (!menu.contains(event.target)) {
    menu.style.display = 'none';
  }
};

function ejecutarOrden(orden) {
  if (tablaActivaMenu === 'principal') {
    filtroPrincipal.columna = columnaActivaMenu;
    filtroPrincipal.orden = orden;
    actualizarLecturas();
  } else {
    filtroAuditoria.columna = columnaActivaMenu;
    filtroAuditoria.orden = orden;
    renderizarTablaAuditoria();
  }
  document.getElementById('excel-filter-menu').style.display = 'none';
}

function ejecutarFiltroTexto() {
  const texto = document.getElementById('excel-search-input').value.toLowerCase().trim();
  if (tablaActivaMenu === 'principal') {
    filtroPrincipal.columna = columnaActivaMenu;
    filtroPrincipal.texto = texto;
    renderizarTablaPrincipal();
  } else {
    filtroAuditoria.columna = columnaActivaMenu;
    filtroAuditoria.texto = texto;
    renderizarTablaAuditoria();
  }
}

// Sincronización continua cada 200ms
setInterval(actualizarLecturas, 200);
actualizarLecturas();

function generarReporte() {
  document.getElementById('rep-total-lecturas').textContent = datosGlobales.total_lecturas_hechas;
  document.getElementById('rep-unicas').textContent = datosGlobales.total_unicas;
  document.getElementById('rep-repetidas').textContent = datosGlobales.total_repetidas;
  document.getElementById('modal-reporte').style.display = 'flex';
}

function cerrarReporte() {
  document.getElementById('modal-reporte').style.display = 'none';
}

function verDetalleAuditoria() {
  filtroAuditoria = { columna: null, orden: 'asc', texto: '' };
  renderizarTablaAuditoria();
  document.getElementById('modal-reporte').style.display = 'none';
  document.getElementById('modal-repetidas-detalle').style.display = 'flex';
}

function cerrarDetalleAuditoria() {
  document.getElementById('modal-repetidas-detalle').style.display = 'none';
  document.getElementById('modal-reporte').style.display = 'flex';
}

async function limpiarTabla() {
  try {
    await fetch('/api/limpiar', { method: 'POST' });
    filtroPrincipal = { columna: null, orden: 'asc', texto: '' };
    filtroAuditoria = { columna: null, orden: 'asc', texto: '' };
    datosGlobales.unicas = [];
    datosGlobales.auditoria = [];
    datosGlobales.total_unicas = 0;
    datosGlobales.total_lecturas_hechas = 0;
    datosGlobales.total_repetidas = 0;
    actualizarInterfazEstado('activo');
    document.getElementById('metric-unique').textContent = '0';
    document.getElementById('metric-total-lecturas').textContent = '0';
    document.getElementById('metric-repetidas').textContent = '0';
    document.getElementById('metric-last-time').textContent = '--:--:--';
    document.getElementById('tabla-lecturas').innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <i class="fa-solid fa-inbox"></i>
            <p>Registros limpiados correctamente. Esperando lecturas...</p>
          </div>
        </td>
      </tr>`;
  } catch (e) {
    console.error("Error al limpiar:", e);
  }
}