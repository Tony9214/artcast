package cc.lumina.artcast

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.UUID

// Embedded HTTP server: hosts the projector page (/app/), the phone page (/),
// static assets, and the REST API used by both sides.
class ArtCastServer(
    context: Context,
    port: Int,
    private val onChange: () -> Unit,
) : NanoHTTPD(port) {

    private val appContext = context.applicationContext
    private val rootDir = File(appContext.filesDir, "artcast").apply { mkdirs() }
    private val imgDir = File(rootDir, "img").apply { mkdirs() }
    private val stateFile = File(rootDir, "state.json")
    private val lock = Any()

    private val state: JSONObject = loadState()

    private fun loadState(): JSONObject {
        val def = JSONObject(
            """{
            "imageId": null, "mode": "original", "invert": false,
            "grid": {"on": false, "n": 3},
            "corners": [[0,0],[1,0],[1,1],[0,1]],
            "history": []
        }"""
        )
        if (!stateFile.exists()) return def
        return try {
            val s = JSONObject(stateFile.readText())
            for (k in def.keys()) if (!s.has(k)) s.put(k, def.get(k))
            s
        } catch (e: Exception) {
            def
        }
    }

    private fun saveState() {
        stateFile.writeText(state.toString())
    }

    private fun lanIp(): String = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it is Inet4Address }
            ?.hostAddress ?: "127.0.0.1"
    } catch (e: Exception) {
        "127.0.0.1"
    }

    override fun serve(session: IHTTPSession): Response {
        return try {
            if (session.uri.startsWith("/api/")) api(session) else static(session)
        } catch (e: Exception) {
            json("{\"error\":\"${e.javaClass.simpleName}\"}", Response.Status.INTERNAL_ERROR)
        }
    }

    // ---------- static ----------

    private fun static(session: IHTTPSession): Response {
        var path = session.uri
        if (path == "/" || path == "") path = "/index.html"
        if (path == "/app" || path == "/app/") path = "/app/index.html"
        if (path.contains("..")) return json("{}", Response.Status.FORBIDDEN)
        return try {
            val stream = appContext.assets.open("www$path")
            newChunkedResponse(Response.Status.OK, NanoHTTPD.getMimeTypeForFile(path), stream)
        } catch (e: Exception) {
            json("{\"error\":\"not found\"}", Response.Status.NOT_FOUND)
        }
    }

    // ---------- api ----------

    private fun api(session: IHTTPSession): Response {
        val uri = session.uri
        val method = session.method
        return when {
            uri == "/api/info" && method == Method.GET ->
                json("""{"uploadUrl":"http://${lanIp()}:$listeningPort/","version":1}""")

            uri == "/api/state" && method == Method.GET ->
                synchronized(lock) { json(state.toString()) }

            uri == "/api/state" && method == Method.POST -> {
                val body = JSONObject(bodyText(session) ?: "{}")
                synchronized(lock) {
                    for (k in body.keys()) {
                        when (k) {
                            "imageId", "mode", "invert", "grid", "corners" -> state.put(k, body.get(k))
                        }
                    }
                    saveState()
                }
                onChange()
                synchronized(lock) { json(state.toString()) }
            }

            uri == "/api/image" && method == Method.PUT -> upload(session)

            uri.startsWith("/api/image/") && method == Method.GET -> {
                val id = uri.removePrefix("/api/image/")
                val f = File(imgDir, id)
                if (!f.exists() || id.contains("/") || id.contains("..")) json("{}", Response.Status.NOT_FOUND)
                else newChunkedResponse(Response.Status.OK, NanoHTTPD.getMimeTypeForFile(id), FileInputStream(f))
            }

            uri == "/api/history" && method == Method.GET ->
                synchronized(lock) {
                    // stored oldest-first; return newest-first
                    val h = state.getJSONArray("history")
                    val out = JSONArray()
                    for (i in h.length() - 1 downTo 0) out.put(h.get(i))
                    json(out.toString())
                }

            uri.startsWith("/api/history/") && method == Method.DELETE -> {
                val id = uri.removePrefix("/api/history/")
                synchronized(lock) {
                    val h = state.getJSONArray("history")
                    for (i in 0 until h.length()) {
                        if (h.getJSONObject(i).getString("id") == id) {
                            h.remove(i)
                            break
                        }
                    }
                    File(imgDir, id).delete()
                    if (state.optString("imageId") == id) state.put("imageId", JSONObject.NULL)
                    saveState()
                }
                onChange()
                json("{}")
            }

            else -> json("{\"error\":\"not found\"}", Response.Status.NOT_FOUND)
        }
    }

    private fun upload(session: IHTTPSession): Response {
        val tmp = bodyFile(session) ?: return json("{\"error\":\"empty\"}", Response.Status.BAD_REQUEST)
        val name = session.parms["name"] ?: "image"
        val ext = name.substringAfterLast('.', "jpg").lowercase()
            .replace(Regex("[^a-z0-9]"), "").ifEmpty { "jpg" }
        val id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}.$ext"
        File(tmp).copyTo(File(imgDir, id), overwrite = true)
        File(tmp).delete()
        synchronized(lock) {
            val h = state.getJSONArray("history")
            h.put(JSONObject().put("id", id).put("name", name).put("ts", System.currentTimeMillis()))
            while (h.length() > 60) {
                val old = h.getJSONObject(0).getString("id")
                File(imgDir, old).delete()
                h.remove(0)
            }
            state.put("imageId", id)
            saveState()
        }
        onChange()
        return json("""{"id":"$id"}""")
    }

    // Returns temp-file path for PUT, or null.
    private fun bodyFile(session: IHTTPSession): String? {
        val files = HashMap<String, String>()
        session.parseBody(files)
        return files["content"]
    }

    private fun bodyText(session: IHTTPSession): String? {
        val files = HashMap<String, String>()
        session.parseBody(files)
        files["postData"]?.let { return it }
        return files["content"]?.let { File(it).readText() }
    }

    private fun json(body: String, status: Response.Status = Response.Status.OK): Response =
        newFixedLengthResponse(status, "application/json", body)
}
