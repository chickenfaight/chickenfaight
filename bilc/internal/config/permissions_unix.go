//go:build unix

package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
)

func prepareDirectory(path string) error {
	return ensureTrustedDirectory(path, true, 0)
}

// Walk from the filesystem root so no untrusted parent can swap a directory or
// file after it has been checked. A trusted sticky directory protects the entries
// owned by the user or root, including newly created private directories.
func ensureTrustedDirectory(path string, leaf bool, links int) error {
	parent := filepath.Dir(path)
	if parent != path {
		if err := ensureTrustedDirectory(parent, false, links); err != nil {
			return err
		}
	}
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		if err := os.Mkdir(path, 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
			return fmt.Errorf("create config directory: %w", err)
		}
		info, err = os.Lstat(path)
	}
	if err != nil {
		return fmt.Errorf("inspect config directory: %w", err)
	}
	owner := int(info.Sys().(*syscall.Stat_t).Uid)
	if info.Mode()&os.ModeSymlink != 0 && !leaf && owner == 0 && links < 40 {
		// macOS uses root-owned links for paths such as /var and /tmp.
		target, err := os.Readlink(path)
		if err != nil {
			return fmt.Errorf("read config directory link: %w", err)
		}
		if filepath.IsAbs(target) {
			if filepath.Clean(target) == target {
				return ensureTrustedDirectory(target, false, links+1)
			}
		} else if filepath.IsLocal(target) && filepath.Clean(target) == target {
			return ensureTrustedDirectory(filepath.Join(parent, target), false, links+1)
		}
	}
	trustedOwner := owner == os.Geteuid() || (!leaf && owner == 0)
	trustedMode := info.Mode().Perm()&0o022 == 0 || (!leaf && info.Mode()&os.ModeSticky != 0)
	if !info.IsDir() || !trustedOwner || !trustedMode {
		return fmt.Errorf("unsafe config directory %q: choose a directory you own under a trusted parent", path)
	}
	return nil
}

func trustedConfigFile(info fs.FileInfo) bool {
	return int(info.Sys().(*syscall.Stat_t).Uid) == os.Geteuid() && info.Mode().Perm()&0o022 == 0
}
