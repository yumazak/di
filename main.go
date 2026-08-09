// Command di はローカルの git 差分をブラウザで見る CLI。
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
)

const usage = `di — ローカルの git 差分をブラウザで見る

使い方:
  di [path] [options]

引数:
  path              リポジトリ内の任意のパス（既定: .）

オプション:
  -p, --port <n>    使用するポート（既定: 空きポートを自動選択）
      --host <h>    バインドするホスト（既定: 127.0.0.1）
      --no-open     ブラウザを自動で開かない
  -h, --help        このヘルプを表示
`

type options struct {
	path string
	port int
	host string
	open bool
}

var errUsage = errors.New("usage")

func parseArgs(argv []string) (options, error) {
	opts := options{path: ".", port: 0, host: "127.0.0.1", open: true}
	pathSeen := false

	for i := 0; i < len(argv); i++ {
		arg := argv[i]

		switch {
		case arg == "-h" || arg == "--help":
			fmt.Print(usage)
			os.Exit(0)

		case arg == "--no-open":
			opts.open = false

		case arg == "-p" || arg == "--port" || arg == "--host":
			i++
			if i >= len(argv) {
				return opts, fmt.Errorf("%w: %s には値が必要です", errUsage, arg)
			}
			if arg == "--host" {
				opts.host = argv[i]
				continue
			}
			port, err := strconv.Atoi(argv[i])
			if err != nil || port < 0 || port > 65535 {
				return opts, fmt.Errorf("%w: ポートの指定が不正です: %s", errUsage, argv[i])
			}
			opts.port = port

		case len(arg) > 0 && arg[0] == '-':
			return opts, fmt.Errorf("%w: 知らないオプションです: %s", errUsage, arg)

		default:
			if pathSeen {
				return opts, fmt.Errorf("%w: パスは 1 つだけ指定できます: %s", errUsage, arg)
			}
			opts.path = arg
			pathSeen = true
		}
	}

	return opts, nil
}

func openBrowser(url string) {
	var command string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
	case "windows":
		command = "start"
	default:
		command = "xdg-open"
	}
	if err := exec.Command(command, url).Start(); err != nil {
		fmt.Fprintf(os.Stderr, "[di] ブラウザを開けませんでした（手動で開いてください）: %s\n", url)
	}
}

func run() error {
	opts, err := parseArgs(os.Args[1:])
	if err != nil {
		return err
	}

	abs, err := filepath.Abs(opts.path)
	if err != nil {
		return err
	}

	repo, err := OpenRepo(abs)
	if err != nil {
		return err
	}

	server, err := StartServer(repo, opts.host, opts.port)
	if err != nil {
		return err
	}

	fmt.Printf("[di] %s\n", repo.Root)
	fmt.Printf("[di] %s\n", server.URL)
	if opts.open {
		openBrowser(server.URL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	return server.Close()
}

func main() {
	if err := run(); err != nil {
		if errors.Is(err, errUsage) {
			fmt.Fprintf(os.Stderr, "[di] %s\n\n", errors.Unwrap(err))
			fmt.Fprint(os.Stderr, usage)
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "[di] %v\n", err)
		os.Exit(1)
	}
}
