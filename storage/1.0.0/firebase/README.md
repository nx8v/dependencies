# firebase

Realtime Database. Isi `config.json` di folder ini, lalu jalankan ulang nx8v.

```json
{
  "project": "my-app-default-rtdb",
  "region": "asia-southeast1",
  "secret": "",
  "token": "",
  "base_url": ""
}
```

`region` kosong memakai `firebaseio.com`. `secret` atau `token` diisi bila rules database mengunci akses. `base_url` menimpa alamat (emulator).

```js
import { firebase } from "/storage";

await firebase({ op: "insert", table: "users", data: { nama: "Budi", umur: 30 } });
await firebase({ op: "select", table: "users", where: { umur: { ">": 20 } } });
```

Perintahnya sama dengan `sqlite`, `mysql`, dan `postgreSQL`. Halaman mengirim JSON ke `POST /api/storage` dengan `"driver": "firebase"`.
