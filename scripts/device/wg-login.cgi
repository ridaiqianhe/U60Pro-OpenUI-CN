#!/bin/sh
umask 077
exec lua /data/plugins/trusted-login/main.lua cgi
