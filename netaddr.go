package main

import (
	"errors"
	"net"
	"syscall"
)

// isAddrInUse は listen 失敗の理由がポート衝突かどうかを見る。
func isAddrInUse(err *net.OpError) bool {
	var sysErr *net.OpError
	if errors.As(error(err), &sysErr) {
		return errors.Is(sysErr.Err, syscall.EADDRINUSE)
	}
	return false
}
