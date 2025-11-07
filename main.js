/* Auto Send NFT (Termux / Node 22.18 / ethers 6.15) Enhanced version: provider readiness check, better error handling, ownership checks, and clearer preview messages to avoid messy repeated JsonRpcProvider retries.

Files required (same folder):

rpc.json        : array of { "name": "BSC Mainnet", "rpc": "https://...", "chainId": 56 }

pk1.txt         : private key(s) for mode 1 (first line used as sender)

pk2.txt         : private keys for mode 2 (one per line)

idnft.txt       : NFT ids, one per line (order matters for mode 2 / optional for mode1)

address.txt     : recipient addresses (one per line) for mode 1


Install dependencies: npm install ethers@6.15 prompts cli-progress dotenv Run with: node main.js */

import fs from "fs"; import path from "path"; import prompts from "prompts"; import { ethers } from "ethers"; import cliProgress from "cli-progress";

const RPC_FILE = "rpc.json"; const PK1_FILE = "pk1.txt"; const PK2_FILE = "pk2.txt"; const IDNFT_FILE = "idnft.txt"; const ADDR_FILE = "address.txt";

function readLines(filename) { try { const raw = fs.readFileSync(path.join(process.cwd(), filename), "utf8"); return raw.split(/ ? /).map(l => l.trim()).filter(Boolean); } catch (e) { return null; } }

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function ensureProviderReady(provider, rpcUrl, retries = 5, delay = 1500) { for (let i = 0; i < retries; i++) { try { const bn = await provider.getBlockNumber(); return true; } catch (e) { if (i === retries - 1) break; // brief wait then retry await sleep(delay); } } console.error(❌ Gagal terhubung ke RPC ${rpcUrl}. Pastikan URL valid & dapat diakses dari perangkatmu.); return false; }

async function main() { // Load rpc.json let rpcJsonRaw; try { rpcJsonRaw = fs.readFileSync(RPC_FILE, 'utf8'); } catch (e) { console.error(❌ File ${RPC_FILE} tidak ditemukan. Buat file rpc.json sesuai format.); process.exit(1); }

let rpcJson; try { rpcJson = JSON.parse(rpcJsonRaw); } catch (e) { console.error(❌ Gagal parse ${RPC_FILE}: ${e.message}); process.exit(1); }

const choices = rpcJson.map((r, i) => ({ title: ${r.name} - ${r.rpc ?? r.endpoint} (chainId ${r.chainId ?? 'unknown'}), value: i })); const respNet = await prompts({ type: 'select', name: 'net', message: '🌐 Pilih jaringan dari rpc.json', choices }); const rpcInfo = rpcJson[respNet.net]; const rpcUrl = rpcInfo.rpc ?? rpcInfo.endpoint; if (!rpcUrl) { console.error('❌ rpc atau endpoint tidak ditemukan untuk network ini.'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(rpcUrl, rpcInfo.chainId); const ok = await ensureProviderReady(provider, rpcUrl, 5, 1200); if (!ok) process.exit(1);

// Choose mode const modeResp = await prompts({ type: 'select', name: 'mode', message: 'Pilih mode pengiriman NFT:', choices: [ { title: '1️⃣  KIRIM DARI SATU → BANYAK', value: 1 }, { title: '2️⃣  KIRIM DARI BANYAK → SATU', value: 2 } ] }); const mode = modeResp.mode;

const { contract } = await prompts({ type: 'text', name: 'contract', message: 'Masukkan contract NFT (0x...)' }); if (!ethers.isAddress(contract)) { console.error('❌ Alamat contract tidak valid!'); process.exit(1); }

// ABIs minimal const ERC721_ABI = [ 'function ownerOf(uint256 tokenId) view returns (address)', 'function safeTransferFrom(address from, address to, uint256 tokenId) external' ]; const ERC1155_ABI = [ 'function balanceOf(address account, uint256 id) view returns (uint256)', 'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external' ];

const contract721 = new ethers.Contract(contract, ERC721_ABI, provider); const contract1155 = new ethers.Contract(contract, ERC1155_ABI, provider);

// Try ERC165 detection let tokenStandard = 'unknown'; try { const is721 = await contract721.supportsInterface?.('0x80ac58cd'); if (is721) tokenStandard = 'erc721'; else { const is1155 = await contract1155.supportsInterface?.('0xd9b67a26'); if (is1155) tokenStandard = 'erc1155'; } } catch (e) { tokenStandard = 'unknown'; }

// Mode handlers if (mode === 1) { const pk1 = readLines(PK1_FILE); const addresses = readLines(ADDR_FILE); const ids = readLines(IDNFT_FILE); if (!pk1 || pk1.length === 0) { console.error(❌ ${PK1_FILE} kosong.); process.exit(1); } if (!addresses || addresses.length === 0) { console.error(❌ ${ADDR_FILE} kosong.); process.exit(1); }

const sender = new ethers.Wallet(pk1[0], provider);

let perRecipientIds = null;
if (ids && ids.length) {
  if (ids.length !== addresses.length) {
    console.warn('⚠️ idnft.txt jumlahnya tidak sama dengan address.txt — script akan menganggap ID tidak dispesifikasikan per recipient.');
    perRecipientIds = null;
  } else perRecipientIds = ids;
}

const plan = addresses.map((to, i) => ({ from: sender.address, to, tokenId: perRecipientIds ? perRecipientIds[i] : null }));

// show preview with extra warnings
console.log('

📋 === PREVIEW TRANSFER ==='); const previewRows = plan.map(p => ({ from: p.from, to: p.to, tokenId: p.tokenId ?? '(not specified)' })); console.table(previewRows);

// warn if any tokenId looks suspicious (e.g., '0' or missing)
let suspicious = false;
previewRows.forEach(r => {
  if (r.tokenId === '0' || r.tokenId === 0) {
    console.warn(`⚠️ Perhatian: tokenId '0' ditemukan untuk penerima ${r.to}. Pastikan idnft.txt berisi id yang benar.`);
    suspicious = true;
  }
  if (r.tokenId === '(not specified)') {
    console.warn(`⚠️ Tidak ada tokenId untuk penerima ${r.to}. Transfer akan dilewati untuk baris ini.`);
    suspicious = true;
  }
});

const { confirm } = await prompts({ type: 'confirm', name: 'confirm', message: 'Lanjutkan kirim NFT sesuai tabel di atas?', initial: false });
if (!confirm) { console.log('❎ Dibatalkan oleh pengguna.'); process.exit(0); }

const bar = new cliProgress.SingleBar({ format: 'Progress |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s' }, cliProgress.Presets.shades_classic);
bar.start(plan.length, 0, { task: 'starting' });

let idx = 0;
for (const p of plan) {
  bar.update(idx, { task: `to ${p.to}` });
  try {
    if (!p.tokenId) { console.log(`⏭️ Skipping ${p.to} karena tokenId tidak dispesifikasikan.`); }
    else {
      const tokenId = ethers.toBigInt(p.tokenId);
      // ownership check for ERC721
      if (tokenStandard === 'erc721') {
        try {
          const owner = await contract721.ownerOf(tokenId);
          if (owner.toLowerCase() !== p.from.toLowerCase()) {
            console.error(`⛔ Wallet ${p.from} bukan pemilik tokenId ${tokenId} (owner=${owner}). Melewati.`);
            idx++; bar.increment(); continue;
          }
          const c = new ethers.Contract(contract, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], new ethers.Wallet(readLines(PK1_FILE)[0], provider));
          const tx = await c.safeTransferFrom(p.from, p.to, tokenId);
          console.log(`➡️ Tx submitted: ${tx.hash}`);
          await tx.wait();
          console.log(`✅ Transfer sukses ke ${p.to} tokenId ${tokenId}`);
        } catch (e) {
          console.error(`⚠️ Gagal kirim ke ${p.to}: ${e.message || e}`);
        }
      } else {
        // try as 1155
        try {
          const bal = await contract1155.balanceOf(p.from, tokenId);
          if (bal <= 0) { console.error(`⛔ Wallet ${p.from} tidak memiliki tokenId ${tokenId} (balance=${bal}). Melewati.`); idx++; bar.increment(); continue; }
          const c = new ethers.Contract(contract, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], new ethers.Wallet(readLines(PK1_FILE)[0], provider));
          const tx = await c.safeTransferFrom(p.from, p.to, tokenId, 1, '0x');
          console.log(`➡️ Tx submitted: ${tx.hash}`);
          await tx.wait();
          console.log(`✅ Transfer sukses ke ${p.to} tokenId ${tokenId}`);
        } catch (e) {
          console.error(`⚠️ Gagal kirim ke ${p.to}: ${e.message || e}`);
        }
      }
    }
  } catch (err) {
    console.error(`⚠️ Error saat memproses ${p.to}: ${err.message || err}`);
  }
  idx++; bar.increment();
}
bar.stop();
console.log('✅ Selesai semua transfer (mode 1).');

} else { // Mode 2: many -> one const pk2 = readLines(PK2_FILE); const ids = readLines(IDNFT_FILE); if (!pk2 || !ids) { console.error('❌ pk2.txt atau idnft.txt kosong.'); process.exit(1); } if (pk2.length !== ids.length) { console.error('❌ Jumlah wallet pk2.txt harus sama dengan idnft.txt'); process.exit(1); }

const { recipient } = await prompts({ type: 'text', name: 'recipient', message: 'Masukkan address tujuan (satu address)' });
if (!ethers.isAddress(recipient)) { console.error('❌ Address tujuan tidak valid!'); process.exit(1); }

const plan = pk2.map((pk, i) => ({ fromPK: pk, to: recipient, tokenId: ids[i] }));

console.log('

📋 === PREVIEW TRANSFER (MANY -> ONE) ==='); const preview = plan.map((p, i) => ({ index: i+1, from: (new ethers.Wallet(p.fromPK)).address, to: p.to, tokenId: p.tokenId })); console.table(preview);

const { confirm } = await prompts({ type: 'confirm', name: 'confirm', message: 'Lanjutkan kirim dari semua wallet di atas?', initial: false });
if (!confirm) { console.log('❎ Dibatalkan oleh pengguna.'); process.exit(0); }

const bar = new cliProgress.SingleBar({ format: 'Progress |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s' }, cliProgress.Presets.shades_classic);
bar.start(plan.length, 0);

let idx = 0;
for (const p of plan) {
  try {
    const signer = new ethers.Wallet(p.fromPK, provider);
    const tokenId = ethers.toBigInt(p.tokenId);
    if (tokenStandard === 'erc721') {
      try {
        const owner = await contract721.ownerOf(tokenId);
        if (owner.toLowerCase() !== signer.address.toLowerCase()) { console.error(`⛔ Wallet ${signer.address} bukan pemilik tokenId ${tokenId}. Melewati.`); idx++; bar.increment(); continue; }
        const c = new ethers.Contract(contract, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], signer);
        const tx = await c.safeTransferFrom(signer.address, p.to, tokenId);
        console.log(`➡️ Tx: ${tx.hash}`); await tx.wait(); console.log(`✅ Sukses ${signer.address}`);
      } catch (e) { console.error(`⚠️ Gagal dari ${signer.address}: ${e.message || e}`); }
    } else {
      try {
        const bal = await contract1155.balanceOf(signer.address, tokenId);
        if (bal <= 0) { console.error(`⛔ Wallet ${signer.address} balance=0 for id ${tokenId}. Melewati.`); idx++; bar.increment(); continue; }
        const c = new ethers.Contract(contract, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], signer);
        const tx = await c.safeTransferFrom(signer.address, p.to, tokenId, 1, '0x');
        console.log(`➡️ Tx: ${tx.hash}`); await tx.wait(); console.log(`✅ Sukses ${signer.address}`);
      } catch (e) { console.error(`⚠️ Gagal dari ${signer.address}: ${e.message || e}`); }
    }
  } catch (err) { console.error(`⚠️ Error for wallet index ${idx}: ${err.message || err}`); }
  idx++; bar.increment();
}
bar.stop();
console.log('✅ Selesai semua transfer (mode 2).');

} }

main().catch(e => { console.error('❌ Fatal error:', e); process.exit(1); });
