#!/bin/sh
umask 077
exec lua /data/plugins/guest-wifi/main.lua cgi
