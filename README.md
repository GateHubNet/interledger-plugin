# Plugin #
Plugin construction options must follow this schema:
```
urls {object}
	notificationsUrl url for the notifications endpoint
	ilpUrl url for the gatehub interledger service
	coreUrl url for the gatehub core service
account {string} address of the account in the following format: gateway_uuid.vault_uuid.user_uuid.wallet_address
gateway {string optional} if set to local it will use local gateway for communication to gatehub
services {object optional} required only if gateway is set to local
```

Plugin consists of the public interface and gateways. There are three implementations of gatehub gateway which are different in the way of communicating with interledger services.
Internal gateway is implemented when plugin is used in the gatehub DMZ and it is not required to be authenticated,
External gateway is to use outside of the gatehub DMZ network and it can be use in the public domain network,
Local gateway is only meant to be used when the plugin is located on the same service as interledger service. This provides much better performance and reliability.

Beside gateways there are also notification implementations which are websocket implementation for external use (less reliable) and rabbit mq implementation for internal use (more reliable).
