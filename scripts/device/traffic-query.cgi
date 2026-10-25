#!/bin/sh
umask 077
exec lua /data/plugins/traffic-query/main.lua cgi
