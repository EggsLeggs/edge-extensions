# Edge Extensions

Each folder is a standalone extension.

| Folder      | What it does                               |
| ----------- | ------------------------------------------ |
| `new-tab/`  | Blank new tab page                         |
| `find-bar/` | Replaces Cmd/Ctrl+F with a custom find bar |

## Loading into edge

1. Open `edge://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick a folder (e.g. `new-tab/`)

After editing files, hit the reload icon on the extension's card. For
`find-bar`, also refresh any open tabs; content scripts only inject on page load.

## License

[MIT](LICENSE). Do whatever you want with this. No warranty, no liability.
