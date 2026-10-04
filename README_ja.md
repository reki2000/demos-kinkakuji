# 金閣寺 WebGL ビューアー

**最も簡単な開き方：`Kinkakuji.html`をブラウザーで開いてください。**
ライブラリ、モデル、材質、環境光のデータを埋め込んでいるため、インターネット接続は不要です。
WebGL 2を使用します。Chrome、Edge、Firefoxなどの最近のブラウザーを想定しています。
直接のHTML表示を制限する環境では、下記のローカルサーバーから表示してください。

## 操作

- ドラッグ：回転。ホイール／ピンチ：拡大縮小。右ドラッグ／2本指：移動。
- 下のボタンで正面、裏側、1階、軒先、風鐸、鳳凰を切り替えます。数字キー1〜6でも切り替えられます。
- 「リアルタイム」：環境光、影、接触部の陰影、水面の反射を表示。
- 「軽量」：一部の陰影処理を省いて描画負荷を抑えます。スマホでは初期設定になります。
- 「高画質」：WebGLで光線を追跡し、静止中に計算を重ねて反射と陰影を精細化します。最初の準備と十分な画質への収束に時間がかかります。PCのGPUでの利用を推奨します。
- 右上の保存ボタンで、現在の3D画像をPNGとして保存できます。

## HTML＋JavaScriptの分割版

`index.html`、`app.js`、`style.css`、`assets/`を同じフォルダー構成で使用します。
モデルを読み込むため、HTTPサーバーから表示してください。

Pythonがある場合、解凍したフォルダーで次を実行します。

```sh
python3 serve.py
```

Windowsで`python3`が見つからない場合は`python serve.py`を使用します。
ブラウザーで **http://localhost:8080** を開きます。
同じファイル構成のまま静的Webサーバーへ配置することもできます。

## ファイル

| ファイル | 内容 |
| --- | --- |
| Kinkakuji.html | 全データを埋め込んだ単体版 |
| index.html / app.js / style.css | 分割版のHTML・描画JavaScript・スタイル |
| assets/kinkakuji.glb | 最新のBlenderモデルから変換・圧縮した建物と庭園の形状 |
| assets/scene.json | 元のカメラ、光源、樹木の配置 |
| assets/sky.hdr | Blenderの空から書き出した環境光 |
| src/ | 編集用JavaScript |
| tools/ | 書き出し・ビルド・検証用スクリプト |
| source/Kinkakuji_eaves_refined.blend | 変換元の編集可能なBlenderモデル |
| review/ | ブラウザーでの確認画像と検証結果 |
| THIRD_PARTY_NOTICES.txt | 同梱ライブラリのライセンス |

## 編集と再ビルド

Node.jsを使う場合、`npm ci`、`npm run build`でJavaScriptと単体HTMLを再生成できます。
通常の閲覧にはNode.jsもBlenderも不要です。

Blenderから形状を書き出し直す場合：

```sh
blender -b source/Kinkakuji_eaves_refined.blend -P tools/export_webgl.py
npm run build
```

## Blender版との対応

建物・屋根・釣殿・鳳凰・風鐸の形状を最新モデルから書き出しています。
空は元モデルのNishita環境をHDRとして保存。金箔・木目・屋根の手続き型材質は、WebGLのPBR材質とテクスチャに置き換えています。
樹木は元の位置・向き・広がりを保ち、針葉の束をインスタンス化した透過テクスチャで表現しています。

高画質モードもCyclesと同一のレンダラーではありません。色調・陰影・反射には差があり、ピクセル単位で同一の画像を保証するものではありません。
風鐸の寸法・穴数・見えない側の配置など、写真から推定した部分はBlender版と共通です。
