# Hold the Merge

**GitHub Merge Two-step confirmation**

A userscript that adds a two-step, typed confirmation, and a countdown timer to the merge action on GitHub Pull Requests, configurable per repository and branch.

## Install

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. Open the [raw userscript URL](https://github.com/jjnilton/hold-the-merge/raw/refs/heads/main/hold-the-merge.user.js) in the browser to install.

## Usage

Press `Ctrl+Alt+M` on a GitHub Pull Request page to open the config editor.

Choose which repositories and branches require typed confirmation, and set the countdown length in seconds.

Example config:

```json
{
  "settings": { "countdown": 5 },
  "repositories": {
    "owner/repository": ["main", "develop"],
    "owner/another-repository": ["*"]
  }
}
```

- After confirming the merge, it will wait 5 seconds (default) before actually merging. (0 to disable/merge immediately after confirming).
- It will ask for confirmation on the branches "main" and "develop" of the repository "owner/repository", and all branches on the "owner/another-repository".
- `"*"` as a repository key applies to every repository. An exact `owner/repo` entry takes precedence.

Missing keys use defaults, and empty objects are not saved.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
