package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestCLI(t *testing.T) {
	for _, tc := range []struct {
		name   string
		args   []string
		output string
		err    string
	}{
		{name: "no arguments", output: "Usage: bilc"},
		{name: "help command", args: []string{"help"}, output: "Usage: bilc"},
		{name: "help flag", args: []string{"--help"}, output: "Usage: bilc"},
		{name: "short help", args: []string{"-h"}, output: "Usage: bilc"},
		{name: "version command", args: []string{"version"}, output: "bilc dev\n"},
		{name: "version flag", args: []string{"--version"}, output: "bilc dev\n"},
		{name: "run help", args: []string{"run", "--help"}, output: "Usage: bilc run"},
		{name: "run short help", args: []string{"run", "-h"}, output: "Usage: bilc run"},
		{name: "verbose accepted", args: []string{"run", "--verbose", "--help"}, output: "Usage: bilc run"},
		{name: "unknown command", args: []string{"other"}, err: "unknown command"},
		{name: "unknown flag", args: []string{"run", "--other"}, err: "flag provided but not defined"},
		{name: "invalid boolean", args: []string{"run", "--verbose=other"}, err: "invalid boolean"},
		{name: "positional argument", args: []string{"run", "ollama"}, err: "positional arguments"},
		{name: "version argument", args: []string{"version", "other"}, err: "does not accept arguments"},
		{name: "help argument", args: []string{"help", "other"}, err: "command help"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			err := run(tc.args, &out)
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("error = %v, want containing %q", err, tc.err)
				}
				if out.Len() != 0 {
					t.Fatalf("unexpected stdout: %q", out.String())
				}
				return
			}
			if err != nil || !strings.Contains(out.String(), tc.output) {
				t.Fatalf("output = %q, error = %v; want %q", out.String(), err, tc.output)
			}
		})
	}
}
