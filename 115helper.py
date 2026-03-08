"""
115helper.py — 115网盘 PotPlayer 本地 Helper 服务
====================================================
功能：接收油猴脚本的播放请求，在 %TEMP% 生成临时 M3U，
     唤起 PotPlayer 播放，播放结束后自动删除临时文件。

后台运行方式（无窗口，开机自启）：
  运行一次 install.bat 即可完成安装，之后开机自动在后台启动。
  卸载请运行 uninstall.bat。
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import subprocess, tempfile, threading, json, os, sys, logging

# ============================================================
#  配置区
# ============================================================

POTPLAYER = r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"
PORT      = 19190

# 日志文件（后台运行时无窗口，通过日志查看状态）
LOG_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), '115helper.log')

# ============================================================
#  日志配置
# ============================================================

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    encoding='utf-8',
)
log = logging.getLogger('115helper')

# ============================================================
#  HTTP 处理
# ============================================================

class PlayHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != '/play':
            self.send_response(404); self.end_headers(); return

        params = parse_qs(parsed.query, keep_blank_values=True)
        urls   = params.get('url',  [])
        names  = params.get('name', [])
        ua     = params.get('ua',   [''])[0]

        if not urls:
            self._respond(400, {'ok': False, 'error': '缺少 url 参数'}); return

        try:
            tmp = tempfile.NamedTemporaryFile(
                suffix='.m3u', delete=False,
                mode='w', encoding='utf-8', prefix='115_'
            )
            tmp.write('#EXTM3U\n')
            for i, url in enumerate(urls):
                name = names[i] if i < len(names) else f'视频{i+1}'
                if ua:
                    tmp.write(f'#EXTVLCOPT:http-user-agent={ua}\n')
                tmp.write(f'#EXTINF:-1 ,{name}\n')
                tmp.write(f'{url}\n')
            tmp.close()
            tmp_path = tmp.name
        except Exception as e:
            log.error(f'生成临时文件失败: {e}')
            self._respond(500, {'ok': False, 'error': str(e)}); return

        def play_and_cleanup(path):
            try:
                proc = subprocess.Popen([POTPLAYER, path])
                proc.wait()
            finally:
                try:
                    os.unlink(path)
                    log.info(f'已清理临时文件: {os.path.basename(path)}')
                except Exception: pass

        threading.Thread(target=play_and_cleanup, args=(tmp_path,), daemon=True).start()
        log.info(f'播放请求: {len(urls)} 个视频')
        self._respond(200, {'ok': True, 'count': len(urls)})

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _respond(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args): pass  # 禁用默认 HTTP 日志


# ============================================================
#  主入口
# ============================================================

def main():
    if not os.path.isfile(POTPLAYER):
        log.error(f'找不到 PotPlayer: {POTPLAYER}')
        sys.exit(1)

    log.info(f'115helper 启动，监听端口 {PORT}')
    try:
        HTTPServer(('127.0.0.1', PORT), PlayHandler).serve_forever()
    except Exception as e:
        log.error(f'服务异常退出: {e}')


if __name__ == '__main__':
    main()
