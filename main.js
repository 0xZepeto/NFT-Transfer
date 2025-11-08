#!/usr/bin/env node

const ethers = require('ethers');
const fs = require('fs');
const readline = require('readline');
const ora = require('ora');
const chalk = require('chalk');

// ABI minimal untuk ERC721
const erc721Abi = [
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function ownerOf(uint256 tokenId) view returns (address)"
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Fungsi untuk menampilkan loading spinner
function showLoading(message) {
    const spinner = ora({
        text: message,
        spinner: 'dots',
        color: 'cyan'
    }).start();
    return spinner;
}

// Fungsi untuk membaca file
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        console.error(chalk.red(`Error membaca file ${filePath}: ${error.message}`));
        process.exit(1);
    }
}

// Fungsi utama
async function main() {
    console.log(chalk.blue.bold('=== NFT Auto Transfer ===\n'));

    // Baca dan pilih jaringan
    const networks = JSON.parse(fs.readFileSync('rpc.json', 'utf8'));
    console.log(chalk.yellow('Pilih jaringan:'));
    networks.forEach((net, index) => {
        console.log(`${index + 1}. ${net.name} (Chain ID: ${net.chainId})`);
    });

    const networkChoice = await questionAsync('Masukkan nomor jaringan: ');
    const selectedNetwork = networks[networkChoice - 1];
    if (!selectedNetwork) {
        console.error(chalk.red('Jaringan tidak valid!'));
        process.exit(1);
    }

    // Setup provider
    const provider = new ethers.JsonRpcProvider(selectedNetwork.rpcUrl || selectedNetwork.endpoint);
    console.log(chalk.green(`\nTerhubung ke ${selectedNetwork.name}\n`));

    // Pilih opsi transfer
    console.log(chalk.yellow('Pilih opsi transfer:'));
    console.log('1. KIRIM DARI SATU KE BANYAK');
    console.log('2. KIRIM DARI BANYAK KE SATU');
    const option = await questionAsync('Masukkan pilihan (1/2): ');

    // Input alamat kontrak NFT
    const contractAddress = await questionAsync('Masukkan alamat kontrak NFT: ');
    if (!ethers.isAddress(contractAddress)) {
        console.error(chalk.red('Alamat kontrak tidak valid!'));
        process.exit(1);
    }

    if (option === '1') {
        await sendFromOneToMany(provider, selectedNetwork, contractAddress);
    } else if (option === '2') {
        await sendFromManyToOne(provider, selectedNetwork, contractAddress);
    } else {
        console.error(chalk.red('Opsi tidak valid!'));
        process.exit(1);
    }

    rl.close();
}

// Opsi 1: Kirim dari satu ke banyak
async function sendFromOneToMany(provider, network, contractAddress) {
    // Baca private key dari .env
    require('dotenv').config();
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error(chalk.red('Private key tidak ditemukan di .env!'));
        process.exit(1);
    }

    // Baca file
    const recipients = readFile('address.txt');
    const tokenIds = readFile('idnft.txt');

    if (recipients.length !== tokenIds.length) {
        console.error(chalk.red('Jumlah alamat penerima dan ID NFT tidak sama!'));
        process.exit(1);
    }

    // Buat wallet
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, erc721Abi, wallet);

    // Preview
    console.log(chalk.blue.bold('\n=== PREVIEW TRANSAKSI ==='));
    console.log(chalk.cyan(`Jaringan: ${network.name}`));
    console.log(chalk.cyan(`Pengirim: ${wallet.address}`));
    console.log(chalk.cyan(`Kontrak NFT: ${contractAddress}`));
    console.log(chalk.yellow('\nDaftar Pengiriman:'));
    recipients.forEach((recipient, i) => {
        console.log(`${i + 1}. NFT ID ${tokenIds[i]} -> ${recipient}`);
    });

    const confirm = await questionAsync('\nLanjutkan transaksi? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
        console.log(chalk.red('Transaksi dibatalkan.'));
        return;
    }

    // Proses transaksi
    console.log(chalk.blue.bold('\n=== PROSES TRANSAKSI ==='));
    for (let i = 0; i < recipients.length; i++) {
        const tokenId = tokenIds[i].trim();
        const recipient = recipients[i].trim();
        const spinner = showLoading(`Mengirim NFT ID ${tokenId} ke ${recipient}...`);

        try {
            // Verifikasi kepemilikan NFT
            const owner = await contract.ownerOf(tokenId);
            if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
                throw new Error('Wallet bukan pemilik NFT ini!');
            }

            // Kirim transaksi
            const tx = await contract.safeTransferFrom(
                wallet.address,
                recipient,
                tokenId
            );

            await tx.wait();
            spinner.succeed(chalk.green(`Berhasil! TX: ${network.explorer}/tx/${tx.hash}`));
        } catch (error) {
            spinner.fail(chalk.red(`Gagal: ${error.message}`));
        }
    }
}

// Opsi 2: Kirim dari banyak ke satu
async function sendFromManyToOne(provider, network, contractAddress) {
    // Baca file
    const privateKeys = readFile('pk.txt');
    const tokenIds = readFile('idnft.txt');

    if (privateKeys.length !== tokenIds.length) {
        console.error(chalk.red('Jumlah private key dan ID NFT tidak sama!'));
        process.exit(1);
    }

    // Input alamat penerima
    const recipient = await questionAsync('Masukkan alamat penerima: ');
    if (!ethers.isAddress(recipient)) {
        console.error(chalk.red('Alamat penerima tidak valid!'));
        process.exit(1);
    }

    // Preview
    console.log(chalk.blue.bold('\n=== PREVIEW TRANSAKSI ==='));
    console.log(chalk.cyan(`Jaringan: ${network.name}`));
    console.log(chalk.cyan(`Penerima: ${recipient}`));
    console.log(chalk.cyan(`Kontrak NFT: ${contractAddress}`));
    console.log(chalk.yellow('\nDaftar Pengiriman:'));
    privateKeys.forEach((pk, i) => {
        const wallet = new ethers.Wallet(pk, provider);
        console.log(`${i + 1}. ${wallet.address} -> NFT ID ${tokenIds[i]}`);
    });

    const confirm = await questionAsync('\nLanjutkan transaksi? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
        console.log(chalk.red('Transaksi dibatalkan.'));
        return;
    }

    // Proses transaksi
    console.log(chalk.blue.bold('\n=== PROSES TRANSAKSI ==='));
    for (let i = 0; i < privateKeys.length; i++) {
        const tokenId = tokenIds[i].trim();
        const privateKey = privateKeys[i].trim();
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(contractAddress, erc721Abi, wallet);
        const spinner = showLoading(`Mengirim NFT ID ${tokenId} dari ${wallet.address}...`);

        try {
            // Verifikasi kepemilikan NFT
            const owner = await contract.ownerOf(tokenId);
            if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
                throw new Error('Wallet bukan pemilik NFT ini!');
            }

            // Kirim transaksi
            const tx = await contract.safeTransferFrom(
                wallet.address,
                recipient,
                tokenId
            );

            await tx.wait();
            spinner.succeed(chalk.green(`Berhasil! TX: ${network.explorer}/tx/${tx.hash}`));
        } catch (error) {
            spinner.fail(chalk.red(`Gagal: ${error.message}`));
        }
    }
}

// Helper untuk input async
function questionAsync(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Jalankan program
main().catch(error => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});
