package main

import (
	"bytes"
	"io"
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
		{name: "pair help", args: []string{"pair", "--help"}, output: "Usage: bilc pair"},
		{name: "unpair help", args: []string{"unpair", "-h"}, output: "Usage: bilc unpair"},
		{name: "status help", args: []string{"status", "--help"}, output: "Usage: bilc status"},
		{name: "model set help", args: []string{"model", "set", "--help"}, output: "Usage: bilc model set"},
		{name: "unknown command", args: []string{"other"}, err: "unknown command"},
		{name: "unknown flag", args: []string{"run", "--other"}, err: "flag provided but not defined"},
		{name: "invalid boolean", args: []string{"run", "--verbose=other"}, err: "invalid boolean"},
		{name: "positional argument", args: []string{"run", "ollama"}, err: "positional arguments"},
		{name: "version argument", args: []string{"version", "other"}, err: "does not accept arguments"},
		{name: "help argument", args: []string{"help", "other"}, err: "command help"},
		{name: "pair without code", args: []string{"pair"}, err: "exactly one pairing code"},
		{name: "pair with two codes", args: []string{"pair", "A", "B"}, err: "exactly one pairing code"},
		{name: "model without set", args: []string{"model"}, err: "bilc model set"},
		{name: "unpair argument", args: []string{"unpair", "x"}, err: "does not accept arguments"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			c := &cli{stdout: &out, stderr: io.Discard, configDir: t.TempDir(), store: memStore{}}
			err := c.run(tc.args)
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
