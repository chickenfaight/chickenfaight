package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

const version = "dev" // TODO inject version for real build

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "bilc:", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 {
		printHelp(out)
		return nil
	}

	switch args[0] {
	case "help", "--help", "-h":
		if len(args) != 1 {
			return errors.New("use bilc <command> --help for command help")
		}
		printHelp(out)
		return nil
	case "version", "--version":
		if len(args) != 1 {
			return errors.New("version does not accept arguments")
		}
		fmt.Fprintln(out, "bilc", version)
		return nil
	case "run":
		flags := flag.NewFlagSet("run", flag.ContinueOnError)
		// Return parse errors to main so they are printed exactly once.
		flags.SetOutput(io.Discard)
		flags.Usage = func() {}
		printRunHelp := func() {
			fmt.Fprintln(out, "Usage: bilc run [--verbose]\n\nEnsure local Ollama is running, then wait until Ctrl-C.\nInference and server integration are not implemented yet.\n\nFlags:\n  --verbose  Show detailed progress\n  -h, --help Show this help\n\nExample:\n  bilc run --verbose")
		}
		verbose := flags.Bool("verbose", false, "Show detailed progress")
		if err := flags.Parse(args[1:]); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				printRunHelp()
				return nil
			}
			return fmt.Errorf("%w; use bilc run --help", err)
		}
		if flags.NArg() != 0 {
			return errors.New("run does not accept positional arguments; use bilc run --help")
		}
		return runOllama(*verbose)
	default:
		return fmt.Errorf("unknown command %q; use bilc --help", args[0])
	}
}

func printHelp(out io.Writer) {
	fmt.Fprintln(out, `BILC — BYOM Interface Layer Client

Usage: bilc <command> [flags]

Commands:
  run      Start or reuse local Ollama until Ctrl-C
  version  Print the version
  help     Show this help

Flags:
  -h, --help Show this help
  --version  Print the version

Examples:
  bilc run --help
  bilc --version`)
}
