#!/bin/sh
umask 077
exec lua /data/plugins/sms-forward/main.lua cgi
