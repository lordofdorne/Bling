package auth

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func encodedKey(fill byte) string {
	return base64.RawURLEncoding.EncodeToString(bytesOf(fill, 32))
}

func bytesOf(fill byte, size int) []byte {
	value := make([]byte, size)
	for index := range value {
		value[index] = fill
	}
	return value
}

func TestTokenCipherRoundTrip(t *testing.T) {
	cipher, err := NewTokenCipher("v2:" + encodedKey(2) + ",v1:" + encodedKey(1))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := cipher.Seal("refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sealed, "v2.") || strings.Contains(sealed, "refresh-secret") {
		t.Fatalf("unexpected ciphertext %q", sealed)
	}
	opened, err := cipher.Open(sealed)
	if err != nil || opened != "refresh-secret" {
		t.Fatalf("Open() = %q, %v", opened, err)
	}
}

func TestTokenCipherReadsPreviousKeyAfterRotation(t *testing.T) {
	oldCipher, err := NewTokenCipher("v1:" + encodedKey(1))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := oldCipher.Seal("refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := NewTokenCipher("v2:" + encodedKey(2) + ",v1:" + encodedKey(1))
	if err != nil {
		t.Fatal(err)
	}
	opened, err := rotated.Open(sealed)
	if err != nil || opened != "refresh-secret" {
		t.Fatalf("Open() = %q, %v", opened, err)
	}
}

func TestTokenCipherRejectsTamperingAndUnknownVersions(t *testing.T) {
	cipher, err := NewTokenCipher("v1:" + encodedKey(1))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := cipher.Seal("refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	tampered := sealed[:len(sealed)-1] + "A"
	if _, err := cipher.Open(tampered); !errors.Is(err, ErrInvalidEncryptedToken) {
		t.Fatalf("tampered Open() error = %v", err)
	}
	if _, err := cipher.Open("v9.payload"); !errors.Is(err, ErrInvalidEncryptedToken) {
		t.Fatalf("unknown-version Open() error = %v", err)
	}
}

func TestTokenCipherValidatesKeyring(t *testing.T) {
	tests := []string{"", "missing-separator", "v1:bad", "v1:" + encodedKey(1) + ",v1:" + encodedKey(2)}
	for _, input := range tests {
		if _, err := NewTokenCipher(input); err == nil {
			t.Fatalf("NewTokenCipher(%q) succeeded", input)
		}
	}
}
