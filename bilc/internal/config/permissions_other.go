//go:build !unix

package config

import (
	"fmt"
	"io/fs"
	"os"
)

func prepareDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	return nil
}

func trustedConfigFile(fs.FileInfo) bool {
	// Windows access is controlled by ACLs rather than Unix mode bits.
	return true
}
