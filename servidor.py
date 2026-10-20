from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import pyodbc
import re

app = Flask(__name__)
CORS(app)

# Configuración de conexión a SQL Server (Autenticación de Windows)
DB_CONFIG = {
    'server': 'localhost\\SQLEXPRESS',
    'database': 'RFID_Inventario',
    'driver': '{ODBC Driver 17 for SQL Server}',
    'trusted_connection': 'yes',
    'encrypt': 'yes',
    'trust_server_certificate': 'yes'
}

def obtener_conexion():
    try:
        conn_str = (
            f"DRIVER={DB_CONFIG['driver']};"
            f"SERVER={DB_CONFIG['server']};"
            f"DATABASE={DB_CONFIG['database']};"
            f"Trusted_Connection={DB_CONFIG['trusted_connection']};"
            f"Encrypt={DB_CONFIG['encrypt']};"
            f"TrustServerCertificate={DB_CONFIG['trust_server_certificate']};"
        )
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"[ERROR DB] No se pudo conectar a SQL Server: {e}")
        return None

def inicializar_bd():
    conn = obtener_conexion()
    if not conn:
        return
    cursor = conn.cursor()
    
    cursor.execute("""
    IF NOT OBJECT_ID('SesionesHistorial', 'U') IS NOT NULL
    CREATE TABLE SesionesHistorial (
        id INT IDENTITY(1,1) PRIMARY KEY,
        fecha VARCHAR(50) NOT NULL,
        total_unicas INT NOT NULL,
        total_lecturas INT NOT NULL,
        creado_en DATETIME DEFAULT GETDATE()
    )
    """)
    
    cursor.execute("""
    IF NOT OBJECT_ID('DetalleSesion', 'U') IS NOT NULL
    CREATE TABLE DetalleSesion (
        id INT IDENTITY(1,1) PRIMARY KEY,
        sesion_id INT FOREIGN KEY REFERENCES SesionesHistorial(id) ON DELETE CASCADE,
        epc VARCHAR(255) NOT NULL,
        hora VARCHAR(20) NOT NULL,
        canal VARCHAR(50) NOT NULL,
        contenido VARCHAR(100) NOT NULL,
        reader_id VARCHAR(100) NOT NULL,
        repeticiones INT NOT NULL,
        es_auditoria BIT NOT NULL
    )
    """)

    cursor.execute("""
    IF NOT OBJECT_ID('SalidasHistorial', 'U') IS NOT NULL
    CREATE TABLE SalidasHistorial (
        id INT IDENTITY(1,1) PRIMARY KEY,
        fecha VARCHAR(50) NOT NULL,
        total_salidas INT NOT NULL,
        detalle_cajas VARCHAR(MAX) NOT NULL
    )
    """)
    conn.commit()
    cursor.close()
    conn.close()

# Inicializar base de datos
inicializar_bd()

estado_sistema = "activo"  # "activo", "pausado", "detenido"
inventario_activo = {}
auditoria_activa = {}

# Configuración de los 4 puertos del Chainway URA4
configuracion_puertos = {
    "puerto_1": {"activo": True, "potencia": 30},
    "puerto_2": {"activo": True, "potencia": 30},
    "puerto_3": {"activo": True, "potencia": 30},
    "puerto_4": {"activo": True, "potencia": 30, "modo": "salida"}
}

MAPEO_NOMBRES = {
    "800420000048970000000000":"2049460",
"800420000045450000000000":"2049459",
"800420000046440000000000":"2049458",
"800420000037840000000000":"2049456",
"800420000047430000000000":"2049457",
"800420000049340000000000":"2049454",
"800420000045070000000000":"2049455",
"E28011B0A5050076EB1C0687":"2049453",
"800420000049100000000000":"2049451",
"800420000046370000000000":"2049452",
"800420000045830000000000":"3720271",
"800420000043300000000000":"3720270",
"800420000045520000000000":"3720268",
"800420000046060000000000":"3720267",
"E28011B0A5050076EB1C0697":"3720266",
"800420000048110000000000":"3720265",
"800420000046510000000000":"3720159",
"800420000048040000000000":"3720156",
"800420000048660000000000":"3720157",
"800420000049030000000000":"3720155",
"800420000042860000000000":"6132941",
"800420000045900000000000":"6132940",
"800420000046200000000000":"6132939",
"800420000048800000000000":"6132938",
"800420000049270000000000":"6132937",
"800420000046750000000000":"6132921",
"800420000043470000000000":"6132922",
"E28011B0A5050076EB1C0667":"6132920",
"800420000044460000000000":"6132919",
"800420000044910000000000":"6132918",

}

def extraer_numero(texto):
    numeros = re.findall(r'\d+', str(texto))
    return int(numeros[0]) if numeros else 999999

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/control', methods=['POST'])
def controlar_sistema():
    global estado_sistema
    datos = request.get_json(silent=True) or {}
    accion = datos.get('accion')
    
    if accion == 'iniciar':
        estado_sistema = "activo"
    elif accion == 'pausar':
        estado_sistema = "pausado"
    elif accion == 'detener':
        estado_sistema = "detenido"
        
    print(f"[CONTROL] Estado cambiado a: {estado_sistema.upper()}")
    return jsonify({"status": "success", "estado": estado_sistema})

@app.route('/api/ura4/config', methods=['GET', 'POST'])
def configurar_ura4():
    global configuracion_puertos
    if request.method == 'POST':
        datos = request.get_json(silent=True) or {}
        puerto = datos.get('puerto')
        if puerto in configuracion_puertos:
            configuracion_puertos[puerto]['activo'] = datos.get('activo', True)
            configuracion_puertos[puerto]['potencia'] = datos.get('potencia', 30)
            return jsonify({"status": "success", "config": configuracion_puertos})
        return jsonify({"status": "error", "message": "Puerto no válido"}), 400
    
    return jsonify({"status": "success", "config": configuracion_puertos})

@app.route('/api/inventory', methods=['GET', 'POST'])
def recibir_rfid():
    global estado_sistema, inventario_activo
    
    if estado_sistema != "activo":
        return jsonify({"status": "ignored", "estado": estado_sistema}), 200

    datos = request.get_json(silent=True) or request.form.to_dict() or request.args.to_dict() or {}
    
    if not datos and request.data:
        try:
            import json
            datos = json.loads(request.data.decode('utf-8'))
        except:
            datos = {}
        
    hora = datetime.now().strftime("%H:%M:%S")
    client_ip = request.remote_addr
    reader_name = f"Chainway URA4 ({client_ip})"

    tags_list = datos.get('tags', [])
    epcs_a_sacar_por_antena_4 = []

    if isinstance(tags_list, list) and len(tags_list) > 0:
        for t in tags_list:
            epc_code = t.get('epc', 'desconocido')
            
            # Auto-detección flexible del parámetro de puerto/antena del URA4
            ant_val = str(
                t.get('ant') or 
                t.get('antenna') or 
                t.get('port') or 
                t.get('antennaPort') or 
                t.get('ch') or '2'
            ).strip()

            clave_puerto = f"puerto_{ant_val}"
            if clave_puerto in configuracion_puertos and not configuracion_puertos[clave_puerto]["activo"]:
                continue # Ignorar si el puerto fue deshabilitado desde la interfaz web
            
            canal_formateado = f"Canal {ant_val}"
            nombre_etiqueta = MAPEO_NOMBRES.get(epc_code, f"caja_descargada_{epc_code[:6]}")

            # REGLA AUTOMÁTICA DE SALIDA POR ANTENA 4
            is_salida = ('4' in ant_val)
            if is_salida:
                epcs_a_sacar_por_antena_4.append(epc_code)

            if epc_code in inventario_activo:
                inventario_activo[epc_code]["repeticiones"] += 1
                if is_salida:
                    inventario_activo[epc_code]["estado_disponibilidad"] = "No Disponible (Facturado)"
                    inventario_activo[epc_code]["canal"] = canal_formateado
            else:
                inventario_activo[epc_code] = {
                    "epc": epc_code,
                    "hora": hora,
                    "canal": canal_formateado,
                    "contenido": nombre_etiqueta,
                    "reader_id": reader_name,
                    "repeticiones": 1,
                    "estado_disponibilidad": "No Disponible (Facturado)" if is_salida else "Disponible"
                }

            if epc_code in auditoria_activa:
                auditoria_activa[epc_code]["repeticiones"] += 1
                auditoria_activa[epc_code]["hora"] = hora
            else:
                auditoria_activa[epc_code] = {
                    "epc": epc_code,
                    "hora": hora,
                    "canal": canal_formateado,
                    "contenido": nombre_etiqueta,
                    "repeticiones": 1
                }
    else:
        gen_id = "generico_" + hora
        item_gen = {
            "epc": gen_id,
            "hora": hora,
            "canal": "Canal 2",
            "contenido": "caja_generica",
            "reader_id": reader_name,
            "repeticiones": 1,
            "estado_disponibilidad": "Disponible"
        }
        inventario_activo[gen_id] = item_gen
        auditoria_activa[gen_id] = item_gen

    # Registrar salidas automáticas de la Antena 4 en SQL Server
    if epcs_a_sacar_por_antena_4:
        fecha_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn = obtener_conexion()
        if conn:
            cursor = conn.cursor()
            try:
                detalle_str = ", ".join(epcs_a_sacar_por_antena_4)
                cursor.execute(
                    "INSERT INTO SalidasHistorial (fecha, total_salidas, detalle_cajas) VALUES (?, ?, ?)",
                    (fecha_str, len(epcs_a_sacar_por_antena_4), detalle_str)
                )
                conn.commit()
            except Exception as e:
                print(f"[ERROR SALIDA ANTENA 4]: {e}")
                conn.rollback()
            finally:
                cursor.close()
                conn.close()

    return jsonify({"status": "success", "message": "Registrado correctamente"}), 200

@app.route('/api/lecturas', methods=['GET'])
def obtener_lecturas():
    global estado_sistema
    orden = request.args.get('orden', 'asc')
    columna = request.args.get('columna', 'contenido')
    
    lista_unicas = list(inventario_activo.values())
    lista_auditoria = list(auditoria_activa.values())
    
    reverse_flag = (orden == 'desc')
    
    if columna == 'contenido':
        lista_unicas.sort(key=lambda x: extraer_numero(x['contenido']), reverse=reverse_flag)
    elif columna == 'repeticiones':
        lista_unicas.sort(key=lambda x: int(x['repeticiones']), reverse=reverse_flag)
    elif columna == 'hora':
        lista_unicas.sort(key=lambda x: x['hora'], reverse=reverse_flag)
    elif columna == 'canal':
        lista_unicas.sort(key=lambda x: x['canal'], reverse=reverse_flag)

    total_lecturas = sum(item["repeticiones"] for item in lista_auditoria)
    total_repetidas = sum(max(0, item["repeticiones"] - 1) for item in lista_unicas)

    historial_desde_db = []
    conn = obtener_conexion()
    if conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, fecha, total_unicas, total_lecturas FROM SesionesHistorial ORDER BY id DESC")
        sesiones = cursor.fetchall()
        
        for s in sesiones:
            s_id, s_fecha, s_unicas, s_lecturas = s
            
            cursor.execute("SELECT epc, hora, canal, contenido, reader_id, repeticiones FROM DetalleSesion WHERE sesion_id = ? AND es_auditoria = 0", (s_id,))
            unicas_db = [{"epc": row[0], "hora": row[1], "canal": row[2], "contenido": row[3], "reader_id": row[4], "repeticiones": row[5]} for row in cursor.fetchall()]

            cursor.execute("SELECT epc, hora, canal, contenido, reader_id, repeticiones FROM DetalleSesion WHERE sesion_id = ? AND es_auditoria = 1", (s_id,))
            auditoria_db = [{"epc": row[0], "hora": row[1], "canal": row[2], "contenido": row[3], "reader_id": row[4], "repeticiones": row[5]} for row in cursor.fetchall()]

            historial_desde_db.append({
                "id": s_id,
                "fecha": s_fecha,
                "total_unicas": s_unicas,
                "total_lecturas": s_lecturas,
                "unicas": unicas_db,
                "auditoria": auditoria_db
            })
        cursor.close()
        conn.close()

    return jsonify({
        "estado": estado_sistema,
        "unicas": lista_unicas,
        "auditoria": lista_auditoria,
        "total_unicas": len(lista_unicas),
        "total_lecturas_hechas": total_lecturas if total_lecturas > 0 else len(lista_unicas),
        "total_repetidas": total_repetidas,
        "historial": historial_desde_db
    })

@app.route('/api/guardar-sesion', methods=['POST'])
def guardar_sesion():
    global inventario_activo, auditoria_activa
    if not inventario_activo:
        return jsonify({"status": "error", "message": "No hay datos en vivo para guardar"}), 400
    
    fecha_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total_unicas = len(inventario_activo)
    total_lecturas = sum(item["repeticiones"] for item in auditoria_activa.values())

    conn = obtener_conexion()
    if not conn:
        return jsonify({"status": "error", "message": "Error de conexión con SQL Server"}), 500
    
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO SesionesHistorial (fecha, total_unicas, total_lecturas) VALUES (?, ?, ?)",
            (fecha_str, total_unicas, total_lecturas)
        )
        conn.commit()

        cursor.execute("SELECT IDENT_CURRENT('SesionesHistorial')")
        row = cursor.fetchone()
        sesion_id = int(row[0]) if row else 1

        for item in inventario_activo.values():
            cursor.execute("""
                INSERT INTO DetalleSesion (sesion_id, epc, hora, canal, contenido, reader_id, repeticiones, es_auditoria)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """, (sesion_id, item['epc'], item['hora'], item['canal'], item['contenido'], item['reader_id'], item['repeticiones']))

        for item in auditoria_activa.values():
            cursor.execute("""
                INSERT INTO DetalleSesion (sesion_id, epc, hora, canal, contenido, reader_id, repeticiones, es_auditoria)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """, (sesion_id, item['epc'], item['hora'], item['canal'], item['contenido'], item.get('reader_id', 'Chainway URA4'), item['repeticiones']))

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"status": "success", "mensaje": "Sesión guardada exitosamente en SQL Server"})
    except Exception as e:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/limpiar', methods=['POST'])
def limpiar_lecturas():
    global inventario_activo, auditoria_activa, estado_sistema
    inventario_activo = {}
    auditoria_activa = {}
    estado_sistema = "activo"
    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3007)