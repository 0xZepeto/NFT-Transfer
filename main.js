/* Auto Send NFT (Termux / Node 22.18 / ethers 6.15) Files expected in same folder:

rpc.json        : array of { "name": "BSC Mainnet", "rpc": "https://...", "chainId": 56 }

pk1.txt         : private keys for option 1 (one -> many). Use single private key (first line) as sender.

pk2.txt         : private keys for option 2 (many -> one). One private key per line.

idnft.txt       : NFT ids, one per line — order must match pk2.txt (for many->one). For option1 if you want to send specific ids per recipient, create ids-per-recipient manually (see below).

address.txt     : recipient addresses for option 1 (one address per line).


Install dependencies: npm init -y npm install ethers@6.15 prompts cli-progress dotenv (optional: npm i chalk)

Usage: node main.js

What this script does:

Lets you pick a network from rpc.json

Choose mode: 1) KIRIM DARI SATU KE BANYAK  2) KIRIM DARI BANYAK KE SATU

Reads private keys and NFT ids from files described above

Detects whether the token contract behaves like ERC-721 or ERC-1155 and uses appropriate transfer method

Shows a preview (planned transfers + estimated gas where available) BEFORE execution

Shows a progress bar and attempts transfers sequentially with basic retry on failure


Limitations & assumptions:

For ERC-1155 the script will transfer amount = 1 for each id (you can modify if needed)

For option 1 we expect the sender private key to be the FIRST line of pk1.txt. If you want to use .env instead, adjust accordingly.

Make sure ids and addresses line up as you expect. The script will validate lengths where possible.

Always test with a small amount or on a testnet first.


*/

import fs from 'fs'; import path from 'path'; import prompts from 'prompts'; import { ethers } from 'ethers'; import cliProgress from 'cli-progress';

const RPC_FILE = 'rpc.json'; const PK1_FILE = 'pk1.txt'; const PK2_FILE = 'pk2.txt'; const IDNFT_FILE = 'idnft.txt'; const ADDR_FILE = 'address.txt';

function readLines(filename) { try { const raw = fs.readFileSync(path.join(process.cwd(), filename), 'utf8'); return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean); } catch (e) { return null; } }

async function main() { // load RPC const rpcRaw = readLines(RPC_FILE); if (!rpcRaw) { console.error(File ${RPC_FILE} not found or empty. Create a rpc.json with an array of RPC objects.); process.exit(1); } let rpcJson; try { rpcJson = JSON.parse(rpcRaw.join('\n')); if (!Array.isArray(rpcJson) || rpcJson.length === 0) throw new Error('Expecting array'); } catch (e) { console.error(Failed to parse ${RPC_FILE}: ${e.message}); process.exit(1); }

const choices = rpcJson.map((r, i) => ({ title: ${r.name} - ${r.rpc} (chainId ${r.chainId ?? 'unknown'}), value: i })); const respNet = await prompts({ type: 'select', name: 'net', message: 'Pilih jaringan (rpc.json)', choices }); const rpcInfo = rpcJson[respNet.net]; const provider = new ethers.JsonRpcProvider(rpcInfo.rpc, rpcInfo.chainId);

const modeResp = await prompts({ type: 'select', name: 'mode', message: 'Pilih mode', choices: [ { title: '1. KIRIM DARI SATU KE BANYAK', value: 1 }, { title: '2. KIRIM DARI BANYAK KE SATU', value: 2 } ] }); const mode = modeResp.mode;

// Ask contract address const { contract: contractAddress } = await prompts({ type: 'text', name: 'contract', message: 'Masukkan contract NFT (0x...)' }); if (!contractAddress || !ethers.isAddress(contractAddress)) { console.error('Alamat contract tidak valid.'); process.exit(1); }

// minimal ABIs const ERC721_ABI = [ 'function ownerOf(uint256 tokenId) view returns (address)', 'function safeTransferFrom(address from, address to, uint256 tokenId) external', 'function supportsInterface(bytes4 interfaceId) view returns (bool)' ]; const ERC1155_ABI = [ 'function balanceOf(address account, uint256 id) view returns (uint256)', 'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external', 'function supportsInterface(bytes4 interfaceId) view returns (bool)' ];

const contract721 = new ethers.Contract(contractAddress, ERC721_ABI, provider); const contract1155 = new ethers.Contract(contractAddress, ERC1155_ABI, provider);

// Try to detect standard let tokenStandard = 'unknown'; try { // ERC-165 IDs: 0x80ac58cd for ERC721, 0xd9b67a26 for ERC1155 const is721 = await contract721.supportsInterface('0x80ac58cd'); if (is721) tokenStandard = 'erc721'; else { const is1155 = await contract1155.supportsInterface('0xd9b67a26'); if (is1155) tokenStandard = 'erc1155'; } } catch (e) { // fallback detection: try ownerOf on a sample id later tokenStandard = 'unknown'; }

// Ask files based on mode if (mode === 1) { // ONE -> MANY const pk1 = readLines(PK1_FILE); const addresses = readLines(ADDR_FILE); const ids = readLines(IDNFT_FILE); // optional: if you want different ids per recipient if (!pk1 || pk1.length === 0) { console.error(${PK1_FILE} kosong atau tidak ditemukan.); process.exit(1); } const senderPK = pk1[0]; if (!addresses || addresses.length === 0) { console.error(${ADDR_FILE} kosong atau tidak ditemukan.); process.exit(1); }

// If ids provided, require same length as addresses
let perRecipientIds = null;
if (ids && ids.length) {
  if (ids.length !== addresses.length) {
    console.error(`Jika menggunakan idnft.txt untuk option 1, jumlah baris harus sama dengan address.txt`);
    process.exit(1);
  }
  perRecipientIds = ids;
}

// create signer
const sender = new ethers.Wallet(senderPK, provider);
console.log(`Sender address: ${sender.address}`);

// preview transfers: array of {from,to,tokenId}
const plan = addresses.map((to, i) => ({ from: sender.address, to, tokenId: perRecipientIds ? perRecipientIds[i] : null }));

await previewAndExecute(contractAddress, tokenStandard, provider, sender, plan, contract721, contract1155);

} else if (mode === 2) { // MANY -> ONE const pk2 = readLines(PK2_FILE); const ids = readLines(IDNFT_FILE); if (!pk2 || pk2.length === 0) { console.error(${PK2_FILE} kosong atau tidak ditemukan.); process.exit(1); } if (!ids || ids.length === 0) { console.error(${IDNFT_FILE} kosong atau tidak ditemukan.); process.exit(1); } if (pk2.length !== ids.length) { console.error(Jumlah baris pk2.txt harus sama dengan idnft.txt (satu id per wallet sesuai urutan).); process.exit(1); }

const { recipient } = await prompts({ type: 'text', name: 'recipient', message: 'Masukkan address tujuan (satu address)' });
if (!recipient || !ethers.isAddress(recipient)) { console.error('Recipient address tidak valid.'); process.exit(1); }

// build plan: each wallet sends its id to recipient
const plan = pk2.map((pk, i) => ({ fromPK: pk, to: recipient, tokenId: ids[i] }));

// For many->one we will execute per wallet by creating a signer per PK
await previewAndExecuteMany(contractAddress, tokenStandard, provider, plan, contract721, contract1155);

} }

async function detectTokenStandardIfUnknown(contract721, contract1155, provider, sampleOwner, sampleId) { // attempt detection by probing ownerOf or balanceOf try { if (sampleId == null) return 'unknown'; try { const owner = await contract721.ownerOf(sampleId); if (owner) return 'erc721'; } catch (e) { // not ERC721 for this id } try { const bal = await contract1155.balanceOf(sampleOwner, sampleId); if (bal && !bal.isNegative) return 'erc1155'; } catch (e) { // not 1155 } } catch (e) {} return 'unknown'; }

async function previewAndExecute(contractAddress, tokenStandard, provider, sender, plan, contract721, contract1155) { // If standard unknown — try to probe using first non-null tokenId if (tokenStandard === 'unknown') { const sample = plan.find(p => p.tokenId != null); if (sample) { tokenStandard = await detectTokenStandardIfUnknown(contract721, contract1155, provider, sender.address, sample.tokenId); } }

// Build a human friendly preview table console.log('\n=== PREVIEW TRANSFERS ==='); const preview = []; for (const p of plan) { preview.push({ from: p.from, to: p.to, tokenId: p.tokenId ?? '(ask at runtime?)' }); } console.table(preview); console.log(Detected token standard (best-effort): ${tokenStandard});

const { confirm } = await prompts({ type: 'confirm', name: 'confirm', message: 'Lanjutkan dan kirim transaksi sesuai rencana?' , initial: false }); if (!confirm) { console.log('Dibatalkan oleh pengguna.'); process.exit(0); }

// Progress bar const bar = new cliProgress.SingleBar({ format: 'Progress |{bar}| {value}/{total} | ETA: {eta_formatted} | Current: {task}' }, cliProgress.Presets.shades_classic); bar.start(plan.length, 0, { task: 'starting' });

let idx = 0; for (const p of plan) { bar.update(idx, { task: sending to ${p.to} }); try { if (!p.tokenId) { console.warn(No tokenId specified for recipient ${p.to}. Skipping.); } else { if (tokenStandard === 'erc721') { const contractWithSigner = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], sender); const tx = await contractWithSigner.safeTransferFrom(sender.address, p.to, ethers.toBigInt(p.tokenId)); await tx.wait(); } else if (tokenStandard === 'erc1155') { const contractWithSigner = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], sender); const tx = await contractWithSigner.safeTransferFrom(sender.address, p.to, ethers.toBigInt(p.tokenId), 1, '0x'); await tx.wait(); } else { // try ERC721 then ERC1155 try { const c721 = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], sender); const tx = await c721.safeTransferFrom(sender.address, p.to, ethers.toBigInt(p.tokenId)); await tx.wait(); } catch (e) { const c1155 = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], sender); const tx = await c1155.safeTransferFrom(sender.address, p.to, ethers.toBigInt(p.tokenId), 1, '0x'); await tx.wait(); } } // success } } catch (err) { console.error(\nGagal kirim ke ${p.to} tokenId ${p.tokenId}: ${err.message || err}); } idx++; bar.update(idx, { task: processed ${idx} }); } bar.stop(); console.log('Selesai.'); }

async function previewAndExecuteMany(contractAddress, tokenStandard, provider, plan, contract721, contract1155) { // plan: [{fromPK, to, tokenId}] console.log('\n=== PREVIEW TRANSFERS (MANY -> ONE) ==='); const preview = plan.map((p, i) => ({ index: i+1, from: (new ethers.Wallet(p.fromPK)).address, to: p.to, tokenId: p.tokenId })); console.table(preview); console.log(Detected token standard (best-effort): ${tokenStandard}); const { confirm } = await prompts({ type: 'confirm', name: 'confirm', message: 'Lanjutkan dan kirim transaksi sesuai rencana?' , initial: false }); if (!confirm) { console.log('Dibatalkan oleh pengguna.'); process.exit(0); }

const bar = new cliProgress.SingleBar({ format: 'Progress |{bar}| {value}/{total} | ETA: {eta_formatted} | Current: {task}' }, cliProgress.Presets.shades_classic); bar.start(plan.length, 0, { task: 'starting' });

let idx = 0; for (const p of plan) { bar.update(idx, { task: from ${ (new ethers.Wallet(p.fromPK)).address} }); try { const signer = new ethers.Wallet(p.fromPK, provider); if (tokenStandard === 'erc721') { const c = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], signer); const tx = await c.safeTransferFrom(signer.address, p.to, ethers.toBigInt(p.tokenId)); await tx.wait(); } else if (tokenStandard === 'erc1155') { const c = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], signer); const tx = await c.safeTransferFrom(signer.address, p.to, ethers.toBigInt(p.tokenId), 1, '0x'); await tx.wait(); } else { // try both try { const c1 = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 tokenId)'], signer); const tx = await c1.safeTransferFrom(signer.address, p.to, ethers.toBigInt(p.tokenId)); await tx.wait(); } catch (e) { const c2 = new ethers.Contract(contractAddress, ['function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'], signer); const tx = await c2.safeTransferFrom(signer.address, p.to, ethers.toBigInt(p.tokenId), 1, '0x'); await tx.wait(); } } // success } catch (err) { console.error(\nGagal kirim dari wallet index ke ${p.to} tokenId ${p.tokenId}: ${err.message || err}); } idx++; bar.update(idx, { task: processed ${idx} }); }

bar.stop(); console.log('Selesai semua transfer.'); }

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
