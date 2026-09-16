# JHHZZY PR Agent

ローカルの変更を「ブランチ作成 → コミット → プッシュ → プルリクエスト作成」まで一気に片付ける CLI です。
PR のタイトルと本文は、実際の diff をもとに Claude が書きます。

```
$ jhhzzy
jhhzzy: → writing the pull request description

jhhzzy: repository : acme/widgets
jhhzzy: base       : main
jhhzzy: head       : jhhzzy/add-retry-to-push-20260916
jhhzzy: commit     : yes (all changes)
jhhzzy: description: claude:claude-opus-5

# Add retry with backoff to git push

`git push` がネットワーク由来で失敗したときに、2s/4s/8s/16s のバックオフで再試行するようにしました。
...

jhhzzy: push and open this pull request? [y/N] y
jhhzzy: → switching to jhhzzy/add-retry-to-push-20260916
jhhzzy: → committing changes
jhhzzy: → pushing jhhzzy/add-retry-to-push-20260916 to origin
jhhzzy: → opening the pull request
https://github.com/acme/widgets/pull/42
```

## インストール

Node.js 20.10 以降が必要です。

```bash
git clone https://github.com/ryoko0111289600984-stack/claud-code.git
cd claud-code
npm install
npm link          # どこからでも `jhhzzy` で呼べるようにする（任意）
```

`npm link` を使わない場合は `node /path/to/claud-code/bin/jhhzzy.js` で直接実行できます。

## 必要な環境変数

| 変数 | 用途 | 無いとどうなるか |
| --- | --- | --- |
| `GITHUB_TOKEN`（`GH_TOKEN` も可） | PR の作成・更新 | PR を作る手前でエラー終了。`--dry-run` / `--no-push` なら不要 |
| `ANTHROPIC_API_KEY` | タイトル・本文の生成 | コミット件名とファイル一覧から機械的に生成した説明にフォールバック |

`ANTHROPIC_API_KEY` の代わりに `ANTHROPIC_AUTH_TOKEN` や `ant auth login` のプロファイルでも動きます
（Anthropic SDK の資格情報解決にそのまま乗っています）。

## 使い方

```bash
jhhzzy                      # 現在の変更から PR を作る
jhhzzy --dry-run            # 何もせず、作られる PR の内容だけ表示する
jhhzzy --draft -y           # 確認なしでドラフト PR を作る
jhhzzy --base develop       # develop 向けの PR にする
jhhzzy --no-ai              # Claude を使わず機械生成の説明にする
jhhzzy --title "Fix login" --body-file pr.md   # 生成を完全に自分の文面で置き換える
```

### 主なオプション

| オプション | 説明 |
| --- | --- |
| `-b, --branch <name>` | コミット・プッシュ先のブランチ。省略時は現在のブランチ（ベースブランチ上にいる場合はタイトルから生成） |
| `--base <branch>` | PR のベースブランチ。省略時はリモートのデフォルトブランチ |
| `--remote <name>` | プッシュ先のリモート（既定 `origin`） |
| `--title` / `--body` / `--body-file` | 生成結果を自分の文面で上書きする |
| `-m, --commit-message <text>` | コミットメッセージ（既定は PR タイトル） |
| `--draft` | ドラフト PR として作成する |
| `--no-ai` | Claude を呼ばない |
| `--model <id>` | 使用するモデル（既定 `claude-opus-5`） |
| `--max-diff-bytes <n>` | Claude に渡す diff の上限バイト数（既定 200000） |
| `--no-commit` / `--no-push` | コミット／プッシュを行わない |
| `--dry-run` | 一切変更せず、実行内容だけ表示する |
| `-y, --yes` | 確認プロンプトを出さない |

全オプションは `jhhzzy --help` を参照してください。

## 動作の流れ

1. git リポジトリであること、リモートが GitHub であることを確認する
2. ベースブランチを決める（`--base` → `origin/HEAD` → `main`/`master` の順）
3. ベースとの差分（コミット済み＋未コミット）を集める
4. リポジトリに PR テンプレートがあれば取得し、本文の下敷きとして Claude に渡す
5. Claude にタイトルと本文を書かせる（構造化出力でタイトル／本文を受け取る）
6. 実行内容を表示して確認を取る（TTY のときのみ。`-y` で省略）
7. 必要ならブランチを切ってコミットし、`git push -u origin <branch>` する
8. 同じ head の open な PR があれば更新、なければ新規作成し、URL を標準出力に出す

### 設計上の判断

- **標準出力は結果だけ**。進捗ログは標準エラーに出るので、`jhhzzy | pbcopy` のように PR の URL だけを拾えます。
- **プッシュの再試行**はネットワーク起因の失敗だけ。`[rejected]` や認証エラーは即座に失敗させます（再試行しても直らないため）。
- **GitHub トークンの解決はプッシュ前**に行います。ブランチだけ公開されて PR が作れない、という中途半端な状態を避けるためです。
- **diff が大きい場合は切り詰めます**が、黙ってではなく警告を出したうえで、ファイル一覧と diffstat は全量を Claude に渡します。
- **Claude が使えない／拒否した場合もツールは止まりません**。コミット件名とファイル一覧から機械的に説明を組み立てて続行します。

## 開発

```bash
npm test        # node:test によるユニットテスト＋一時リポジトリを使った結合テスト
```

テストは Anthropic API にも GitHub API にも接続しません（どちらもスタブ）。結合テストは
一時ディレクトリに bare リポジトリと作業リポジトリを作って実際の git を動かします。

## ライセンス

MIT
