#!/bin/sh
umask 077
exec lua /data/plugins/neighbor-scan/main.lua cgi
