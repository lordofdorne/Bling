package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

var ErrInvalidEncryptedToken = errors.New("encrypted token is invalid")

type tokenKey struct {
	version string
	aead    cipher.AEAD
}

type TokenCipher struct {
	active tokenKey
	keys   map[string]cipher.AEAD
	random io.Reader
}

// NewTokenCipher parses a comma-separated keyring. The first key encrypts new
// values; all listed keys can decrypt existing values. Entries use
// "version:base64-encoded-32-byte-key".
func NewTokenCipher(keyring string) (*TokenCipher, error) {
	var ordered []tokenKey
	keys := make(map[string]cipher.AEAD)
	for _, raw := range strings.Split(keyring, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		version, encoded, ok := strings.Cut(raw, ":")
		if !ok || version == "" || strings.Contains(version, ".") {
			return nil, errors.New("session encryption keys must use version:base64-key")
		}
		if _, exists := keys[version]; exists {
			return nil, fmt.Errorf("duplicate session encryption key version %q", version)
		}
		material, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			material, err = base64.StdEncoding.DecodeString(encoded)
		}
		if err != nil || len(material) != 32 {
			return nil, fmt.Errorf("session encryption key %q must be a base64-encoded 32-byte key", version)
		}
		block, err := aes.NewCipher(material)
		if err != nil {
			return nil, fmt.Errorf("create session cipher: %w", err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("create session AEAD: %w", err)
		}
		key := tokenKey{version: version, aead: aead}
		ordered = append(ordered, key)
		keys[version] = aead
	}
	if len(ordered) == 0 {
		return nil, errors.New("at least one session encryption key is required")
	}
	return &TokenCipher{active: ordered[0], keys: keys, random: rand.Reader}, nil
}

func (c *TokenCipher) Seal(token string) (string, error) {
	if token == "" {
		return "", errors.New("cannot encrypt an empty token")
	}
	nonce := make([]byte, c.active.aead.NonceSize())
	if _, err := io.ReadFull(c.random, nonce); err != nil {
		return "", fmt.Errorf("generate token nonce: %w", err)
	}
	sealed := c.active.aead.Seal(nonce, nonce, []byte(token), []byte(c.active.version))
	return c.active.version + "." + base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (c *TokenCipher) Open(value string) (string, error) {
	version, encoded, ok := strings.Cut(value, ".")
	if !ok || version == "" || encoded == "" {
		return "", ErrInvalidEncryptedToken
	}
	aead, ok := c.keys[version]
	if !ok {
		return "", ErrInvalidEncryptedToken
	}
	sealed, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(sealed) < aead.NonceSize()+aead.Overhead() {
		return "", ErrInvalidEncryptedToken
	}
	nonce, ciphertext := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	plaintext, err := aead.Open(nil, nonce, ciphertext, []byte(version))
	if err != nil {
		return "", ErrInvalidEncryptedToken
	}
	return string(plaintext), nil
}
