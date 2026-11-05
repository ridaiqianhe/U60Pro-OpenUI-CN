#!/bin/sh
umask 077
exec lua /data/plugins/tailscale/main.lua cgi
