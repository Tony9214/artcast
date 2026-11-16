# ArtCast

把安卓投影仪变成绘画起形助手：参考图投射到画布上，四点透视校准对齐画框，
支持素描/边缘/网格等描摹辅助模式。开源免费替代「简画」。

## 功能

- 手机扫码打开局域网网页上传参考图（与投影仪同一网络即可，不限 2.4G）
- 遥控器方向键做四点单应变换（keystone），对齐任意画框角度
- 显示模式：原图 / 素描（color-dodge 线稿）/ 边缘检测（Sobel）
- 可叠加网格（密度可调）、反色
- 历史记录：手机端可回看、切换、删除
- 全部数据存在投影仪本地，无账号、无订阅、无网络依赖

## 架构

```
Android APK (WebView + NanoHTTPD :8917)
├── /app/          投影端页面（全屏画面 + 角点编辑）
├── /              手机端页面（上传、模式切换、历史）
├── /api/*         REST：state / image / history / info
└── assets/www/    全部前端代码（纯 HTML/JS，无构建）
```

变形由 CSS `matrix3d` 完成；滤镜为纯 Canvas 实现；服务端只做静态托管与状态/文件存储。

## 开发调试（不需要安卓环境）

```bash
python3 dev/server.py
# 投影端: http://127.0.0.1:8917/app/   （方向键=遥控器，回车=OK）
# 手机端: http://<局域网IP>:8917/
```

桌面浏览器里直接拖拽图片到投影页也能上传。

## 按键（投影端）

| 键 | 功能 |
| --- | --- |
| 方向键 | 移动当前角点（长按加速） |
| OK / 回车 | 切换下一个角点 |
| 1 / 2 / 3 | 原图 / 素描 / 边缘 |
| G / I | 网格 / 反色 |
| R | 四角复位全屏 |
| Q | 显示/隐藏上传二维码 |
| F | 全屏 |
| H | 显示/隐藏角点与帮助条 |

## 构建 APK

需要 Android Studio（或 JDK 17 + Android SDK）：

```bash
./gradlew assembleDebug   # 产出 app/build/outputs/apk/debug/app-debug.apk
```

或者直接用 Android Studio 打开本仓库 → Run。装到投影仪：拷 APK 到
FAT32 U 盘插投影仪安装，或 `adb connect <投影仪IP>:5555 && adb install`。

minSdk 23（Android 6.0+），横屏 + Leanback launcher，适配电视/投影仪桌面。
