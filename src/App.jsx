import { useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import AcademicRegistryABI from './contracts/AcademicRegistryABI.json';
import { CONTRACT_ADDRESS } from './contracts/config';

// ⚠️ Replace with your actual Pinata JWT token
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

function App() {
  const [activeTab, setActiveTab] = useState('issue');
  const [account, setAccount] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // --- Multi-File Issue Form States ---
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [studentIdsInput, setStudentIdsInput] = useState('');
  const [processedHashes, setProcessedHashes] = useState([]);
  const [batchStatus, setBatchStatus] = useState([]);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // --- Verify Form States ---
  const [verifyFile, setVerifyFile] = useState(null);
  const [verifyHashInput, setVerifyHashInput] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const switchToSepolia = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
      return true;
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0xaa36a7',
                chainName: 'Sepolia Test Network',
                nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
          return true;
        } catch (addError) {
          console.error('Failed to add Sepolia:', addError);
        }
      }
      return false;
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setErrorMessage('MetaMask is not installed.');
      return;
    }

    try {
      setIsConnecting(true);
      setErrorMessage('');

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== 11155111) {
        const switched = await switchToSepolia();
        if (!switched) {
          setErrorMessage('Please switch MetaMask network to Sepolia.');
          setIsConnecting(false);
          return;
        }
      }

      const accounts = await provider.send('eth_requestAccounts', []);
      setAccount(accounts[0]);
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setErrorMessage('Failed to connect wallet.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Helper to compute SHA-256 for a file
  const computeSHA256 = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // 1. Handle Multiple File Selection
  const handleMultipleFilesChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setSelectedFiles(files);
    setStatus(`Computing SHA-256 hashes for ${files.length} file(s)...`);

    const hashes = [];
    for (let file of files) {
      const hashHex = await computeSHA256(file);
      hashes.push({ name: file.name, hash: hashHex });
    }

    setProcessedHashes(hashes);
    setStatus(`Calculated hashes for ${files.length} document(s).`);
  };

  // 2. Upload single file to Pinata IPFS
  const uploadToIPFS = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${PINATA_JWT}`,
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return res.data.IpfsHash;
  };

  // 3. Batch Issue Loop
  const handleIssueBatchTranscripts = async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      alert('Please select at least one transcript PDF.');
      return;
    }

    // Split student IDs by comma or newline
    const studentIds = studentIdsInput
      .split(/[\n,]+/)
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (studentIds.length !== selectedFiles.length) {
      alert(`Mismatch: You selected ${selectedFiles.length} file(s) but entered ${studentIds.length} Student ID(s). Please provide one ID per file.`);
      return;
    }

    try {
      setIsLoading(true);
      setBatchStatus([]);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, AcademicRegistryABI, signer);

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const studentId = studentIds[i];
        const fileHash = processedHashes[i].hash;

        setStatus(`[${i + 1}/${selectedFiles.length}] Uploading ${file.name} to IPFS...`);

        // Step A: Upload file to Pinata
        const cid = await uploadToIPFS(file);

        setStatus(`[${i + 1}/${selectedFiles.length}] Pinned to IPFS (CID: ${cid}). Confirm transaction in MetaMask...`);

        // Step B: Submit on-chain transaction
        const tx = await contract.issueTranscript(studentId, fileHash, cid);
        setStatus(`[${i + 1}/${selectedFiles.length}] Transaction submitted! Hash: ${tx.hash.slice(0, 10)}... Awaiting block confirmation...`);

        await tx.wait();

        // Update batch results
        setBatchStatus(prev => [
          ...prev,
          { name: file.name, studentId, hash: fileHash, cid, txHash: tx.hash, status: 'Success' }
        ]);
      }

      setStatus(`✅ Batch complete! Successfully registered ${selectedFiles.length} transcript(s) on-chain.`);
    } catch (error) {
      console.error('Error in batch issuance:', error);
      setStatus(`❌ Error during batch operation: ${error.reason || error.message || 'Transaction failed.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setVerifyFile(file);
    const hashHex = await computeSHA256(file);
    setVerifyHashInput(hashHex);
  };

  const handleVerifyTranscript = async (e) => {
    e.preventDefault();
    if (!verifyHashInput) {
      alert('Please upload a PDF or enter a valid SHA-256 Hash.');
      return;
    }

    try {
      setIsVerifying(true);
      setVerifyResult(null);

      const provider = window.ethereum
        ? new ethers.BrowserProvider(window.ethereum)
        : new ethers.JsonRpcProvider("https://rpc.sepolia.org");

      const contract = new ethers.Contract(CONTRACT_ADDRESS, AcademicRegistryABI, provider);
      const result = await contract.verifyTranscript(verifyHashInput);

      setVerifyResult({
        isValid: result.isValid,
        studentId: result.studentId,
        ipfsCID: result.ipfsCID,
        universityName: result.universityName,
        timestamp: Number(result.timestamp) > 0
          ? new Date(Number(result.timestamp) * 1000).toLocaleString()
          : 'N/A'
      });
    } catch (error) {
      console.error('Error verifying transcript:', error);
      alert('Verification failed. Check network connection or contract ABI.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0F172A] via-[#1E293B] to-[#0F172A] text-white flex flex-col justify-between font-sans">
      {/* Top Bar for Wallet Connection & Brand Logo */}
      <header className="max-w-6xl w-full mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center space-x-3 cursor-pointer select-none">
          {/* Glowing Indicator Dot */}
          <span className="relative flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
          </span>

          {/* Prominent Company Brand Heading */}
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent">
            VaultScript
          </span>
        </div>

        <div>
          {!account ? (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="px-6 py-2.5 bg-white text-[#0F172A] font-semibold text-sm rounded-full hover:bg-slate-200 transition-all shadow-md"
            >
              {isConnecting ? 'Connecting...' : 'Connect MetaMask Wallet'}
            </button>
          ) : (
            <div className="px-4 py-2 bg-slate-800/80 border border-slate-700 rounded-full text-xs font-mono text-cyan-300">
              ✓ {account.slice(0, 6)}...{account.slice(-4)}
            </div>
          )}
        </div>
      </header>

      {/* Hero Header */}
      <main className="max-w-5xl w-full mx-auto px-6 py-8 text-center flex-1 flex flex-col justify-center items-center">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.1] mb-12 max-w-4xl">
          Instant Academic Credential Verification And Storage
        </h1>

        {/* Action Toggle Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 w-full max-w-2xl">
          <button
            onClick={() => setActiveTab('issue')}
            className={`w-full sm:w-72 py-5 px-8 rounded-2xl font-bold text-lg sm:text-xl transition-all duration-300 shadow-xl ${activeTab === 'issue'
              ? 'bg-[#FFFFF0] text-[#0F172A] scale-105 shadow-cyan-500/10'
              : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 border border-slate-700'
              }`}
          >
            Issue Transcript
          </button>
          <button
            onClick={() => setActiveTab('verify')}
            className={`w-full sm:w-72 py-5 px-8 rounded-2xl font-bold text-lg sm:text-xl transition-all duration-300 shadow-xl ${activeTab === 'verify'
              ? 'bg-[#FFFFF0] text-[#0F172A] scale-105 shadow-cyan-500/10'
              : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 border border-slate-700'
              }`}
          >
            Public Verifier
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="max-w-xl w-full mb-6 p-4 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-xl">
            {errorMessage}
          </div>
        )}

        {/* Form Container */}
        <div className="w-full max-w-2xl text-left bg-slate-900/70 backdrop-blur-md border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          {/* TAB 1: ISSUANCE PORTAL */}
          {activeTab === 'issue' && (
            <div>
              {!account ? (
                <div className="text-center py-6">
                  <p className="text-slate-400 text-sm mb-4">Please connect your MetaMask wallet to issue transcripts on-chain.</p>
                  <button
                    onClick={connectWallet}
                    className="px-6 py-3 bg-[#FFFFF0] text-[#0F172A] font-bold text-sm rounded-xl hover:bg-slate-200 transition-all"
                  >
                    Connect MetaMask Wallet
                  </button>
                </div>
              ) : (
                <form onSubmit={handleIssueBatchTranscripts} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Select Transcript Document(s) (PDF) - Multiple Allowed:
                    </label>
                    <input
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={handleMultipleFilesChange}
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-700 file:text-cyan-300 hover:file:bg-slate-600 cursor-pointer"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Student ID(s) or Address(es) (Separate with commas or newlines):
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. STU-001, STU-002, STU-003"
                      value={studentIdsInput}
                      onChange={(e) => setStudentIdsInput(e.target.value)}
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      required
                    />
                    <span className="text-[11px] text-slate-500 block mt-1">
                      Enter IDs in the exact order matching your selected PDF files.
                    </span>
                  </div>

                  {/* Hash Preview List */}
                  {processedHashes.length > 0 && (
                    <div className="p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-xs space-y-2 max-h-40 overflow-y-auto">
                      <span className="text-slate-400 block font-semibold">Computed Cryptographic Hashes ({processedHashes.length}):</span>
                      {processedHashes.map((item, idx) => (
                        <div key={idx} className="border-b border-slate-700/50 pb-1">
                          <span className="text-slate-300 font-semibold">{item.name}: </span>
                          <span className="font-mono text-cyan-300 break-all">{item.hash}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-base rounded-xl transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                  >
                    {isLoading ? 'Processing Pipeline...' : `Issue ${selectedFiles.length > 1 ? selectedFiles.length + ' Transcripts' : 'Transcript'} On-Chain`}
                  </button>

                  {status && (
                    <div className="p-4 bg-slate-800/90 border border-slate-700 rounded-xl text-xs text-slate-300 space-y-2">
                      <p className="font-semibold text-cyan-300">{status}</p>
                    </div>
                  )}

                  {/* Completed Transcripts Summary */}
                  {batchStatus.length > 0 && (
                    <div className="p-4 bg-slate-800/90 border border-emerald-500/40 rounded-xl text-xs space-y-3 mt-4">
                      <h4 className="font-bold text-emerald-400 text-sm">Processed Transcripts ({batchStatus.length})</h4>
                      {batchStatus.map((item, idx) => (
                        <div key={idx} className="border-b border-slate-700 pb-2 space-y-0.5">
                          <p className="text-white font-semibold">{item.name} &rarr; <span className="text-cyan-300">{item.studentId}</span></p>
                          <p className="text-slate-400 break-all">IPFS CID: <a href={`https://gateway.pinata.cloud/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">{item.cid}</a></p>
                        </div>
                      ))}
                    </div>
                  )}
                </form>
              )}
            </div>
          )}

          {/* TAB 2: VERIFICATION PORTAL */}
          {activeTab === 'verify' && (
            <div>
              <form onSubmit={handleVerifyTranscript} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Upload PDF Transcript to Verify:
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleVerifyFileChange}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-700 file:text-cyan-300 hover:file:bg-slate-600 cursor-pointer"
                  />
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-slate-800"></div>
                  <span className="flex-shrink mx-4 text-xs font-semibold uppercase text-slate-500">OR</span>
                  <div className="flex-grow border-t border-slate-800"></div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Or Enter SHA-256 Hash Directly:
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={verifyHashInput}
                    onChange={(e) => setVerifyHashInput(e.target.value)}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {isVerifying ? 'Checking Blockchain...' : 'Verify Transcript'}
                </button>
              </form>

              {/* Verification Results */}
              {verifyResult && (
                <div className={`mt-6 p-5 rounded-xl border ${verifyResult.isValid
                  ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                  }`}>
                  {verifyResult.isValid ? (
                    <div className="space-y-3">
                      <h3 className="text-base font-bold text-emerald-400">✅ Authentic Transcript Verified</h3>
                      <div className="space-y-1 text-xs">
                        <p><strong>Student ID / Address:</strong> {verifyResult.studentId}</p>
                        <p><strong>Issuing University:</strong> {verifyResult.universityName || 'Authorized Institution'}</p>
                        <p><strong>Issued Timestamp:</strong> {verifyResult.timestamp}</p>
                        <p className="break-all">
                          <strong>IPFS Document CID:</strong>{' '}
                          <a href={`https://gateway.pinata.cloud/ipfs/${verifyResult.ipfsCID}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
                            {verifyResult.ipfsCID}
                          </a>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-rose-400">❌ Record Not Found / Tampered Document</h3>
                      <p className="text-xs text-rose-300/80">This SHA-256 hash does not exist in the Academic Registry. Either the file has been altered or it was never issued by an authorized university.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-slate-500">
        VaultScript Decentralized Academic Registry
      </footer>
    </div>
  );
}

export default App;