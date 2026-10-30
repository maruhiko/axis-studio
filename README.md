# Axis Studio — 3D Model Viewer

ブラウザのみで動く、Unity の Scene View を意識した **3D モデルビュワー**です。GitHub Pages 対応。ビルド、サーバー、API キーは不要です。

![status](https://img.shields.io/badge/Deploy-GitHub%20Pages-85c779) ![three](https://img.shields.io/badge/Three.js-r186.1-85c779)

## 🚀 GitHub Pages への公開

1. GitHub で新規リポジトリを作成（例：`axis-studio`）。
2. 本フォルダの `index.html`、`styles.css`、`src/`、`favicon.svg`、`.nojekyll` をリポジトリの **ルート**にアップロード（フォルダ自体を一段追加しない）。
3. `Settings` → `Pages` → `Build and deployment` を開く。
4. `Source: Deploy from a branch`、`Branch: main`、`Folder: /(root)` を選び `Save`。
5. デプロイ完了後、`https://<username>.github.io/axis-studio/` からアクセス。

ローカルでは HTTP サーバーを使って起動してください。`file://` 直開きはブラウザの ES modules 制限により動作しないことがあります。

```bash
cd axisforge-viewer
python3 -m http.server 8080
# http://localhost:8080/
```

GitHub Pages 上でもローカルでも、Three.js は固定バージョン `0.186.1` を jsDelivr CDN から読み込みます。そのため **最初の起動時はネットワーク接続が必要**です。Three.js ライブラリ自体をプロジェクトに含める方式ではありません。

## 機能

| 分類 | 内容 |
| --- | --- |
| ファイル読込 | GLB / GLTF（外部 `.bin` / テクスチャ複数選択）/ OBJ / STL |
| 操作ギズモ | 移動 (W)、回転 (E)、拡大縮小 (R)、視点操作 (Q) |
| 数値編集 | Position XYZ、Rotation XYZ（度）、Scale XYZ |
| ギズモ設定 | World / Local 座標系、移動 0.25・回転 15°・拡大 0.1 のスナップ |
| カメラ | Orbit、パン、ズーム、モデル全体表示 (F)、透視／平行投影 |
| 視点ギズモ | 右上の X/Y/Z・−X/−Y/−Z をクリックして軸方向視点へ |
| 表示 | グリッド・軸・ワイヤーフレームの表示切替、背景色切替、自動回転 |
| アニメーション | GLB / GLTF に収録されたクリップの再生、一時停止、切替 |
| 編集補助 | Transform リセット、Undo / Redo、変換 JSON のコピー／貼り付け |
| 情報 | メッシュ・三角形・頂点数、ファイルサイズ、バウンディングボックスの寸法 |
| 出力 | 現在のカメラから PNG 画像、現在の変換を反映した GLB モデル |
| サンプル | 初回起動ですぐ試せるプロシージャルな Orbit Bot |
| UI | デスクトップとスマートフォン、タッチ操作対応 |

## キーボードショートカット

| キー | 操作 |
| --- | --- |
| Q | 視点操作（ギズモ非表示） |
| W | 移動ギズモ |
| E | 回転ギズモ |
| R | 拡大縮小ギズモ |
| F | モデル全体を表示 |
| G | グリッドの表示／非表示 |
| Ctrl/Cmd + Z | 取り消し |
| Ctrl/Cmd + Shift + Z | やり直し |

キャンバスの左ドラッグで視点回転、右ドラッグでパン、ホイールでズーム。タッチデバイスは一本指で回転、二本指でズーム／パン。ギズモのハンドルをドラッグするとモデルが変形します。

## GLTF/GLB の注意事項

- `.glb` は原則 1 ファイルで完結します。`.gltf` は別途 `.bin`、画像ファイルを参照している場合があるため、**関連ファイルをまとめて選択またはドロップ**してください。`gltf` がサブフォルダ内のテクスチャを参照する場合、ファイル名による照合を試みます。
- OBJ はジオメトリ表示に対応します。`.mtl` による外部マテリアル自動読み込みは現状非対応です。
- STL は頂点カラーや部品階層を持たない場合があります。ビューアでは標準マテリアルが適用されます。
- モデルのローカル座標を保ちながら、ビューポート中心に見えるように **読み込み時の外側のピボットを中心合わせ**しています。書き出し時もこのピボットを含みます。
- 書き出す GLB は **モデルと現在の Transform** を含みます。ビューア上の照明、補助グリッド、カメラ、ギズモは含みません。アニメーションクリップの書き出しは対象外です。
- Three.js の標準ローダーのみを使用しており、DRACO / KTX2 / Meshopt などの圧縮された glTF にはデコーダーの追加が必要な場合があります。
- モデルはブラウザ上で読み込み、サーバーへアップロードしません。GitHub Pages の静的配信だけで動作します。

## フォルダ構成

```text
axisforge-viewer/
├── index.html       # UI と import map
├── styles.css       # レスポンシブなスタイリング
├── src/
│   └── main.js      # Three.js・ギズモ・入出力・イベント
├── favicon.svg
├── .nojekyll
└── README.md
```

## ライセンス

このサンプルアプリのコードは MIT License です（`LICENSE`）。Three.js は Three.js 側の MIT License に従います。
