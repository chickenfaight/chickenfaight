package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/config"
)

// Set at release time with -ldflags "-X main.version=... -X main.defaultServerURL=...".
var (
	version          = "dev"
	defaultServerURL = "http://localhost:8000"
)

// cli holds what commands need from the machine, so tests can replace it.
type cli struct {
	stdout, stderr io.Writer
	// Empty means the user's config directory.
	configDir string
	// Nil means the system keychain, with a file fallback.
	store auth.Store
}

func main() {
	c := &cli{stdout: os.Stdout, stderr: os.Stderr}
	if err := c.run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "bilc:", err)
		os.Exit(1)
	}
}

func (c *cli) run(args []string) error {
	if len(args) == 0 {
		printHelp(c.stdout)
		return nil
	}

	switch args[0] {
	case "help", "--help", "-h":
		if len(args) != 1 {
			return errors.New("use bilc <command> --help for command help")
		}
		printHelp(c.stdout)
		return nil
	case "version", "--version":
		if len(args) != 1 {
			return errors.New("version does not accept arguments")
		}
		fmt.Fprintln(c.stdout, "bilc", version)
		return nil
	case "run":
		return c.runCommand(args[1:])
	case "pair":
		return c.pair(args[1:])
	case "unpair":
		return c.unpair(args[1:])
	case "status":
		return c.status(args[1:])
	case "model":
		if len(args) < 2 || args[1] != "set" {
			return errors.New("use bilc model set --model <name>; see bilc model set --help")
		}
		return c.modelSet(args[2:])
	default:
		return fmt.Errorf("unknown command %q; use bilc --help", args[0])
	}
}

// parseFlags parses a command's flags, printing usage for -h/--help (done is
// then true). Flags may follow positional arguments (`bilc pair CODE --server
// URL`); the positional ones are returned for the command to check.
func (c *cli) parseFlags(flags *flag.FlagSet, args []string, usage string) (positional []string, done bool, err error) {
	// Return parse errors to main so they are printed exactly once.
	flags.SetOutput(io.Discard)
	flags.Usage = func() {}
	for {
		if err := flags.Parse(args); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				fmt.Fprintln(c.stdout, usage)
				return nil, true, nil
			}
			return nil, false, fmt.Errorf("%w; use bilc %s --help", err, flags.Name())
		}
		if flags.NArg() == 0 {
			return positional, false, nil
		}
		positional = append(positional, flags.Arg(0))
		args = flags.Args()[1:]
	}
}

func (c *cli) dir() (string, error) {
	if c.configDir != "" {
		return c.configDir, nil
	}
	return config.Dir()
}

func (c *cli) loadConfig() (config.Config, string, error) {
	dir, err := c.dir()
	if err != nil {
		return config.Config{}, "", err
	}
	path := filepath.Join(dir, "config.json")
	cfg, err := config.Load(path, defaultServerURL)
	return cfg, path, err
}

func (c *cli) credentials() (auth.Store, error) {
	if c.store != nil {
		return c.store, nil
	}
	dir, err := c.dir()
	if err != nil {
		return nil, err
	}
	return &auth.SystemStore{FilePath: filepath.Join(dir, "credentials.json"), Warn: c.stderr}, nil
}

func printHelp(out io.Writer) {
	fmt.Fprintln(out, `BILC — BYOM Interface Layer Client

Usage: bilc <command> [flags]

Commands:
  pair <code>  Pair this machine with your account, using a code from the BILC page
  model set    Choose the local model to play with
  run          Connect to the server and serve matches until Ctrl-C
  status       Show pairing, server, and model status
  unpair       Delete this machine's credentials
  version      Print the version
  help         Show this help

Flags:
  -h, --help Show this help
  --version  Print the version

Examples:
  bilc pair ABCD-EFGH
  bilc model set --model llama3.2:3b
  bilc run`)
}
