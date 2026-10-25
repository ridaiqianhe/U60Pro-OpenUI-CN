# Operator query → stock monthly allowance

Installed under `/data/plugins/traffic-query`, loaded by the existing sms-forward
worker. No additional boot service. The dashboard CGI uses normal agent Bearer
authentication. Existing forwarding destinations and daily query are unchanged.

Enable `config.json` with `{"auto_sync":true}`. Initialization records current
SMS IDs/dates; only new, same-day carrier replies are eligible. Manual query sends
one carrier-specific SMS and persists intent before sending. Unknown send status
is never retried automatically. Parsing accepts an explicit nationwide general
monthly aggregate; ambiguous bundles leave the official allowance unchanged.

Firmware calls `zwrt_data.set_wwandst_monthlimit` and
`zwrt_data.set_wwandst_calibmonth` set the byte cap and absolute monthly used
amount. GB follows the stock 1024³-byte convention. The B04 daemon checks the
official UCI option
`zwrt_data_commit.wwancid1dst.month_limit_overflow_auto_disconn_enable` at limit
enforcement time. The ubus `overflow_auto_disconn` parameter alone does not enable
that persisted option on this firmware. Both the quota and option are read back;
failure restores the previous monthly used amount, limit and cutoff option.
Snapshots remain private on device. Reset day is preserved.

The worker monitors replies every 15 seconds, also handling the existing daily
query reply. Turning automatic sync off stops future writes, while the last
configured stock quota continues working. On a detected SIM change, a quota
previously applied by this module is disabled if its value is still unchanged.
The next SIM requires a new reply. No historical SMS is reused.

Device parser regression: `lua test.lua parser.lua`.
