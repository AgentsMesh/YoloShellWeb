# Temporary LAN access

The server binds `0.0.0.0` so a trusted LAN can reach it. It accepts loopback
names, the machine's local IPv4 interface addresses, and IPv4 addresses listed
in `YOLO_WEB_ALLOWED_HOSTS`, all with the exact listening port. A present
`Origin` must equal `http://<Host>`. DNS names are rejected.

When Yolo runs in an OrbStack machine, OrbStack forwards the VM's `4199` to the
host's `0.0.0.0:4199`. Start the plugin with the host's LAN IPv4 so browsers on
the host LAN can use it:

```sh
YOLO_WEB_ALLOWED_HOSTS=<host-lan-ip> yolo plugin startup
# comma-separate multiple IPv4 addresses
```

Then open `http://<host-lan-ip>:4199/` from another machine. The bearer token
is still required. LAN traffic is plain HTTP, so use this only on a trusted
network while the temporary mode is enabled. The management socket, Hub
identity and token are never sent to the browser.
