package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/config"
)

const requestTimeout = 30 * time.Second

func platform() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}

// commandContext ends on Ctrl-C, SIGTERM, or the timeout.
func commandContext() (context.Context, context.CancelFunc) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	return ctx, func() { cancel(); stop() }
}

// warnIfInsecure warns when tokens would cross the network unencrypted.
func (c *cli) warnIfInsecure(server *url.URL) {
	if server.Scheme == "http" && !config.IsLoopback(server) {
		fmt.Fprintf(c.stderr, "warning: %s isn't HTTPS; your device credentials would travel unencrypted\n", server)
	}
}

func (c *cli) pair(args []string) error {
	flags := flag.NewFlagSet("pair", flag.ContinueOnError)
	server := flags.String("server", "", "Server URL")
	name := flags.String("name", "", "Device name shown on the BILC page")
	positional, done, err := c.parseFlags(flags, args, `Usage: bilc pair <code> [--server URL] [--name NAME]

Pair this machine with your account. Get the code from the BILC page in the
web app; it works once, for 10 minutes.

Flags:
  --server URL  Server to pair with (default: the saved one, or `+defaultServerURL+`)
  --name NAME   Device name shown on the BILC page (default: this computer's name)
  -h, --help    Show this help`)
	if done || err != nil {
		return err
	}
	if len(positional) != 1 {
		return errors.New("pair needs exactly one pairing code; use bilc pair --help")
	}

	cfg, path, err := c.loadConfig()
	if err != nil {
		return err
	}
	store, err := c.credentials()
	if err != nil {
		return err
	}
	if cfg.BilcID != "" {
		if _, err := store.Load(cfg.BilcID); err == nil {
			return errors.New("this machine is already paired; run `bilc unpair` first")
		}
	}
	if *server != "" {
		cfg.ServerURL = *server
	}
	serverURL, err := config.ParseHTTPURL(cfg.ServerURL)
	if err != nil {
		return fmt.Errorf("server URL: %w", err)
	}
	c.warnIfInsecure(serverURL)
	deviceName := strings.TrimSpace(*name)
	if deviceName == "" {
		if deviceName, err = os.Hostname(); err != nil || deviceName == "" {
			deviceName = "BILC on " + runtime.GOOS
		}
	}

	ctx, cancel := commandContext()
	defer cancel()
	client := &auth.Client{ServerURL: cfg.ServerURL}
	registration, err := client.Register(ctx, auth.RegisterRequest{
		PairingCode:   positional[0],
		DeviceName:    deviceName,
		Platform:      platform(),
		ClientVersion: version,
	})
	if err != nil {
		return fmt.Errorf("pairing failed: %w", err)
	}
	if err := store.Save(registration.BilcID, registration.RefreshToken); err != nil {
		return fmt.Errorf("paired, but couldn't save credentials (revoke this device on the BILC page and pair again): %w", err)
	}
	cfg.BilcID = registration.BilcID
	if err := config.Save(path, cfg); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "Paired as %q.\n", deviceName)
	if cfg.Model.Name == "" {
		fmt.Fprintln(c.stdout, "Next, choose your model: bilc model set --model <name>")
	} else {
		fmt.Fprintln(c.stdout, "Start serving matches with: bilc run")
	}
	return nil
}

func (c *cli) unpair(args []string) error {
	flags := flag.NewFlagSet("unpair", flag.ContinueOnError)
	positional, done, err := c.parseFlags(flags, args, `Usage: bilc unpair

Delete this machine's credentials. Revoke the device on the BILC page too, so
the server forgets it.`)
	if done || err != nil {
		return err
	}
	if len(positional) != 0 {
		return errors.New("unpair does not accept arguments")
	}
	cfg, path, err := c.loadConfig()
	if err != nil {
		return err
	}
	if cfg.BilcID == "" {
		fmt.Fprintln(c.stdout, "This machine isn't paired.")
		return nil
	}
	store, err := c.credentials()
	if err != nil {
		return err
	}
	if err := store.Delete(cfg.BilcID); err != nil {
		return err
	}
	cfg.BilcID = ""
	if err := config.Save(path, cfg); err != nil {
		return err
	}
	fmt.Fprintln(c.stdout, "Unpaired. Also revoke this device on the BILC page, so the server forgets it.")
	return nil
}

func (c *cli) status(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	positional, done, err := c.parseFlags(flags, args, `Usage: bilc status

Show the version, server, pairing, and model settings. Checks that the server
is reachable and still accepts this device.`)
	if done || err != nil {
		return err
	}
	if len(positional) != 0 {
		return errors.New("status does not accept arguments")
	}
	cfg, path, err := c.loadConfig()
	if err != nil {
		return err
	}
	store, err := c.credentials()
	if err != nil {
		return err
	}
	ctx, cancel := commandContext()
	defer cancel()

	fmt.Fprintln(c.stdout, "Version:", version)
	client := &auth.Client{ServerURL: cfg.ServerURL}
	reachable := client.Health(ctx)
	if reachable != nil {
		fmt.Fprintf(c.stdout, "Server:  %s (unreachable: %v)\n", cfg.ServerURL, reachable)
	} else {
		fmt.Fprintf(c.stdout, "Server:  %s (reachable)\n", cfg.ServerURL)
	}

	paired := false
	if cfg.BilcID != "" {
		_, err := store.Load(cfg.BilcID)
		paired = err == nil
	}
	switch {
	case !paired:
		fmt.Fprintln(c.stdout, "Paired:  no (run bilc pair <code>)")
	case reachable != nil:
		fmt.Fprintln(c.stdout, "Paired:  yes (not checked; server unreachable)")
	default:
		session := &auth.Session{Client: client, Store: store, BilcID: cfg.BilcID}
		if _, err := session.AccessToken(ctx, true); errors.Is(err, auth.ErrNotPaired) {
			cfg.BilcID = ""
			if saveErr := config.Save(path, cfg); saveErr != nil {
				return saveErr
			}
			fmt.Fprintf(c.stdout, "Paired:  no; %v\n", err)
		} else if err != nil {
			fmt.Fprintf(c.stdout, "Paired:  yes (couldn't check: %v)\n", err)
		} else {
			fmt.Fprintln(c.stdout, "Paired:  yes (server accepts this device)")
		}
	}

	if cfg.Model.Name == "" {
		fmt.Fprintln(c.stdout, "Model:   not set (run bilc model set --model <name>)")
	} else {
		fmt.Fprintf(c.stdout, "Model:   %s at %s\n", cfg.Model.Name, cfg.Model.BaseURL)
	}
	return nil
}

func (c *cli) modelSet(args []string) error {
	flags := flag.NewFlagSet("model set", flag.ContinueOnError)
	baseURL := flags.String("url", config.DefaultModelURL, "Base URL of the OpenAI-compatible API")
	name := flags.String("model", "", "Model name")
	positional, done, err := c.parseFlags(flags, args, `Usage: bilc model set --model <name> [--url <base_url>]

Choose the local model to play with. The model is not contacted yet.

Flags:
  --model NAME  Model name, as your model server names it (e.g. llama3.2:3b)
  --url URL     OpenAI-compatible base URL (default: `+config.DefaultModelURL+`, local Ollama)
  -h, --help    Show this help`)
	if done || err != nil {
		return err
	}
	if len(positional) != 0 {
		return errors.New("model set does not accept positional arguments; use bilc model set --help")
	}
	modelName := strings.TrimSpace(*name)
	if modelName == "" || len(modelName) > 128 {
		return errors.New("--model is required (at most 128 characters); use bilc model set --help")
	}
	modelURL, err := config.ParseHTTPURL(*baseURL)
	if err != nil {
		return fmt.Errorf("--url: %w", err)
	}
	if !config.IsLoopback(modelURL) {
		fmt.Fprintf(c.stderr, "warning: %s isn't on this machine; debate prompts will leave it\n", modelURL)
	}
	cfg, path, err := c.loadConfig()
	if err != nil {
		return err
	}
	cfg.Model = config.Model{BaseURL: modelURL.String(), Name: modelName}
	if err := config.Save(path, cfg); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "Model set to %s at %s.\n", modelName, modelURL)
	return nil
}
