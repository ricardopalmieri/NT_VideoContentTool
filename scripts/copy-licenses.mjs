// Os avisos acompanham a distribuição estática enviada ao Hostinger.
import { copyFile, cp } from 'node:fs/promises';

for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md', 'TRADEMARKS.md']) {
  await copyFile(file, `dist/${file}`);
}
await cp('LICENSES', 'dist/LICENSES', { recursive: true });
