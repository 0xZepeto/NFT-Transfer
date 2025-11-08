#!/usr/bin/env node

const ethers = require('ethers');
const fs = require('fs');
const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');

// ABI minimal untuk deteksi token standard
const detectionAbi = [
    "function supportsInterface(bytes4 interfaceID) external view returns (bool)"
];

// ABI untuk ERC721
const erc721Abi = [
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function ownerOf(uint256 tokenId) view returns (address)"
];

// ABI untuk ERC1155
const erc1155Abi = [
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "function balanceOf(address account, uint256 id) view returns (uint256)"
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Fungsi untuk menampilkan loading spinner
function showLoading(message) {
    const spinner = ora(message).start();
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

// Fungsi untuk mendeteksi token standard
async function detectTokenStandard(provider, contractAddress) {
    const detectionContract = new ethers.Contract(contractAddress, detectionAbi, provider);
    
    try {
        // Cek apakah ERC721
        const isERC721 = await detectionContract.supportsInterface("0x80ac58cd");
        if (isERC721) {
            return "erc721";
        }
        
        // Cek apakah ERC1155
        const isERC1155 = await detectionContract.supportsInterface("0xd9b67a26");
        if (isERC1155) {
            return "erc1155";
        }
        
        // Default ke ERC721 jika tidak terdeteksi
        return "erc721";
    } catch (error) {
        console.log(chalk.yellow("⚠️ Tidak bisa mendeteksi token standard, menggunakan ERC721 sebagai default"));
        return "erc721";
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

    // Deteksi token standard
    const tokenStandard = await detectTokenStandard(provider, contractAddress);
    console.log(chalk.green(`\nDeteksi token standard: ${tokenStandard.toUpperCase()}\n`));

    if (option === '1') {
        await sendFromOneToMany(provider, selectedNetwork, contractAddress, tokenStandard);
    } else if (option === '2') {
        await sendFromManyToOne(provider, selectedNetwork, contractAddress, tokenStandard);
    } else {
        console.error(chalk.red('Opsi tidak valid!'));
        process.exit(1);
    }

    rl.close();
}

// Opsi 1: Kirim dari satu ke banyak
async function sendFromOneToMany(provider, network, contractAddress, tokenStandard) {
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
    
    // Pilih ABI berdasarkan token standard
    const abi = tokenStandard === "erc1155" ? erc1155Abi : erc721Abi;
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    // Preview
    console.log(chalk.blue.bold('\n=== PREVIEW TRANSAKSI ==='));
    console.log(chalk.cyan(`Jaringan: ${network.name}`));
    console.log(chalk.cyan(`Token Standard: ${tokenStandard.toUpperCase()}`));
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
            if (tokenStandard === "erc721") {
                const owner = await contract.ownerOf(tokenId);
                if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
                    throw new Error('Wallet bukan pemilik NFT ini!');
                }
            } else {
                // Untuk ERC1155, cek balance
                const balance = await contract.balanceOf(wallet.address, tokenId);
                if (balance === 0n) {
                    throw new Error('Wallet tidak memiliki NFT ini!');
                }
            }

            // Kirim transaksi
            let tx;
            if (tokenStandard === "erc1155") {
                tx = await contract.safeTransferFrom(
                    wallet.address,
                    recipient,
                    tokenId,
                    1, // amount
                    "0x" // data
                );
            } else {
                tx = await contract.safeTransferFrom(
                    wallet.address,
                    recipient,
                    tokenId
                );
            }

            await tx.wait();
            spinner.succeed(chalk.green(`Berhasil! TX: ${network.explorer}/tx/${tx.hash}`));
        } catch (error) {
            spinner.fail(chalk.red(`Gagal: ${error.message}`));
        }
    }
}

// Opsi 2: Kirim dari banyak ke satu
async function sendFromManyToOne(provider, network, contractAddress, tokenStandard) {
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
    console.log(chalk.cyan(`Token Standard: ${tokenStandard.toUpperCase()}`));
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
        
        // Pilih ABI berdasarkan token standard
        const abi = tokenStandard === "erc1155" ? erc1155Abi : erc721Abi;
        const contract = new ethers.Contract(contractAddress, abi, wallet);
        
        const spinner = showLoading(`Mengirim NFT ID ${tokenId} dari ${wallet.address}...`);

        try {
            // Verifikasi kepemilikan NFT
            if (tokenStandard === "erc721") {
                const owner = await contract.ownerOf(tokenId);
                if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
                    throw new Error('Wallet bukan pemilik NFT ini!');
                }
            } else {
                // Untuk ERC1155, cek balance
                const balance = await contract.balanceOf(wallet.address, tokenId);
                if (balance === 0n) {
                    throw new Error('Wallet tidak memiliki NFT ini!');
                }
            }

            // Kirim transaksi
            let tx;
            if (tokenStandard === "erc1155") {
                tx = await contract.safeTransferFrom(
                    wallet.address,
                    recipient,
                    tokenId,
                    1, // amount
                    "0x" // data
                );
            } else {
                tx = await contract.safeTransferFrom(
                    wallet.address,
                    recipient,
                    tokenId
                );
            }

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
