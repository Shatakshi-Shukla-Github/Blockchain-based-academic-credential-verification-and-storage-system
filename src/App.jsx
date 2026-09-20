import { useState } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import AcademicRegistryABI from './contracts/AcademicRegistryABI.json';
import { CONTRACT_ADDRESS } from './contracts/config';

// ⚠️ Replace with your actual Pinata JWT token
const PINATA_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIzYmM4YWVhOS05MzU2LTQwM2UtYTk1MC00NjMzOGE4ZDJkYzYiLCJlbWFpbCI6InNoYXRha3NoaXNodWtsYTQ5QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiIxODZkMjViMzczZjI3NjcyN2JkMSIsInNjb3BlZEtleVNlY3JldCI6ImY3MTc5MzNmYWRiOGRiMjlhZTZhMTM1OGEwZjVhM2ZhMTM0NDRhZGRkYTVhZTE5NzNiYjZhMmU3Yjg1YzM3YzIiLCJleHAiOjE4MjE0NTE2NTV9.RV1WGGHjNHzZsQyJL5LYTP1Z29-XvwZTQLFRudzp5b4";

function App() {
  const [activeTab, setActiveTab] = useState('issue'); // 'issue' or 'verify'
  const [account, setAccount] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // --- Issue Form States ---
  const [selectedFile, setSelectedFile] = useState(null);
  const [studentAddress, setStudentAddress] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [ipfsCid, setIpfsCid] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // --- Verify Form States ---
  const [verifyFile, setVerifyFile] = useState(null);
  const [verifyHashInput, setVerifyHashInput] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Helper to switch network to Sepolia
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

  // Connect MetaMask
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

  // 1. Calculate SHA-256 Hash for Issuance
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile(file);
    setStatus('Computing cryptographic hash...');

    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    setFileHash(hashHex);
    setStatus('Hash calculated successfully!');
  };

  // 2. Upload PDF to Pinata IPFS
  const uploadToIPFS = async () => {
    if (!selectedFile) throw new Error('No file selected.');

    const formData = new FormData();
    formData.append('file', selectedFile);

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

  // 3. Store Record On-Chain
  const handleIssueTranscript = async (e) => {
    e.preventDefault();
    if (!fileHash || !studentAddress || !selectedFile) {
      alert('Please fill out all fields and select a transcript PDF.');
      return;
    }

    try {
      setIsLoading(true);
      setStatus('Uploading transcript to IPFS...');

      const cid = await uploadToIPFS();
      setIpfsCid(cid);
      setStatus(`Pinned to IPFS (CID: ${cid}). Prompting wallet transaction...`);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, AcademicRegistryABI, signer);

      const tx = await contract.issueTranscript(studentAddress, fileHash, cid);

      setStatus(`Transaction submitted! Hash: ${tx.hash}. Awaiting confirmation...`);
      await tx.wait();

      setStatus('✅ Transcript successfully registered on-chain!');
    } catch (error) {
      console.error('Error issuing transcript:', error);
      setStatus(`❌ Error: ${error.reason || error.message || 'Transaction failed.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Calculate SHA-256 Hash for Verification File
  const handleVerifyFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setVerifyFile(file);
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    setVerifyHashInput(hashHex);
  };

  // 5. Query Smart Contract to Verify Transcript
  const handleVerifyTranscript = async (e) => {
    e.preventDefault();
    if (!verifyHashInput) {
      alert('Please upload a PDF or enter a valid SHA-256 Hash.');
      return;
    }

    try {
      setIsVerifying(true);
      setVerifyResult(null);

      // Provider fallback (works even if user is not connected via MetaMask)
      const provider = window.ethereum
        ? new ethers.BrowserProvider(window.ethereum)
        : new ethers.JsonRpcProvider("https://rpc.sepolia.org");

      const contract = new ethers.Contract(CONTRACT_ADDRESS, AcademicRegistryABI, provider);

      // Call view function verifyTranscript(string _hash)
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
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '650px', margin: '0 auto' }}>
      <h1>VaultScript Portal</h1>
      <p>Decentralized Academic Transcript Verification System</p>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '2px solid #ddd', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('issue')}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            fontWeight: activeTab === 'issue' ? 'bold' : 'normal',
            border: 'none',
            borderBottom: activeTab === 'issue' ? '3px solid #0066cc' : 'none',
            background: 'none',
            cursor: 'pointer'
          }}
        >
          University Admin (Issue)
        </button>
        <button
          onClick={() => setActiveTab('verify')}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            fontWeight: activeTab === 'verify' ? 'bold' : 'normal',
            border: 'none',
            borderBottom: activeTab === 'verify' ? '3px solid #0066cc' : 'none',
            background: 'none',
            cursor: 'pointer'
          }}
        >
          Public Verification
        </button>
      </div>

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', border: '1px solid red', borderRadius: '4px' }}>
          {errorMessage}
        </div>
      )}

      {/* TAB 1: ISSUANCE PORTAL */}
      {activeTab === 'issue' && (
        <div>
          {!account ? (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer' }}
            >
              {isConnecting ? 'Connecting...' : 'Connect MetaMask Wallet'}
            </button>
          ) : (
            <div>
              <div style={{ padding: '1rem', background: '#f4f4f4', borderRadius: '8px', marginBottom: '1.5rem' }}>
                <h3 style={{ color: 'green', margin: 0 }}>✓ University Admin Connected</h3>
                <p style={{ margin: '0.5rem 0 0 0' }}><strong>Address:</strong> {account}</p>
              </div>

              <form onSubmit={handleIssueTranscript} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label><strong>Student ID or Address:</strong></label>
                  <input
                    type="text"
                    placeholder="STU-12345 or 0x..."
                    value={studentAddress}
                    onChange={(e) => setStudentAddress(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                    required
                  />
                </div>

                <div>
                  <label><strong>Select Transcript Document (PDF):</strong></label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    style={{ width: '100%', marginTop: '0.25rem' }}
                    required
                  />
                </div>

                {fileHash && (
                  <div style={{ fontSize: '0.85rem', background: '#eef', padding: '0.5rem', borderRadius: '4px', wordBreak: 'break-all' }}>
                    <strong>Computed SHA-256 Hash:</strong> {fileHash}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  style={{ padding: '0.75rem', fontSize: '1rem', cursor: 'pointer', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px' }}
                >
                  {isLoading ? 'Processing...' : 'Issue Transcript On-Chain'}
                </button>
              </form>

              {status && (
                <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                  <strong>Status:</strong> {status}
                  {ipfsCid && (
                    <p style={{ margin: '0.5rem 0 0 0', wordBreak: 'break-all' }}>
                      <strong>IPFS Gateway Link:</strong>{' '}
                      <a href={`https://gateway.pinata.cloud/ipfs/${ipfsCid}`} target="_blank" rel="noreferrer">
                        View Document on IPFS
                      </a>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: VERIFICATION PORTAL */}
      {activeTab === 'verify' && (
        <div>
          <form onSubmit={handleVerifyTranscript} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label><strong>Upload PDF Transcript to Verify:</strong></label>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleVerifyFileChange}
                style={{ width: '100%', marginTop: '0.25rem' }}
              />
            </div>

            <div>
              <label><strong>Or Enter SHA-256 Hash Directly:</strong></label>
              <input
                type="text"
                placeholder="0x..."
                value={verifyHashInput}
                onChange={(e) => setVerifyHashInput(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying}
              style={{ padding: '0.75rem', fontSize: '1rem', cursor: 'pointer', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}
            >
              {isVerifying ? 'Checking Blockchain...' : 'Verify Transcript'}
            </button>
          </form>

          {/* Verification Results Output */}
          {verifyResult && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', borderRadius: '6px', background: verifyResult.isValid ? '#d4edda' : '#f8d7da', border: `1px solid ${verifyResult.isValid ? '#c3e6cb' : '#f5c6cb'}` }}>
              {verifyResult.isValid ? (
                <div>
                  <h3 style={{ color: '#155724', margin: '0 0 0.5rem 0' }}>✅ Authentic Transcript Verified</h3>
                  <p><strong>Student ID / Address:</strong> {verifyResult.studentId}</p>
                  <p><strong>Issuing University:</strong> {verifyResult.universityName || 'Authorized Institution'}</p>
                  <p><strong>Issued Timestamp:</strong> {verifyResult.timestamp}</p>
                  <p style={{ wordBreak: 'break-all' }}>
                    <strong>IPFS Document CID:</strong>{' '}
                    <a href={`https://gateway.pinata.cloud/ipfs/${verifyResult.ipfsCID}`} target="_blank" rel="noreferrer">
                      {verifyResult.ipfsCID}
                    </a>
                  </p>
                </div>
              ) : (
                <div>
                  <h3 style={{ color: '#721c24', margin: '0 0 0.5rem 0' }}>❌ Record Not Found / Tampered Document</h3>
                  <p style={{ color: '#721c24', margin: 0 }}>This SHA-256 hash does not exist in the Academic Registry. Either the file has been altered or it was never issued by an authorized university.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;















// import { useState } from 'react';
// import { ethers } from 'ethers';
// import axios from 'axios';
// import AcademicRegistryABI from './contracts/AcademicRegistryABI.json';
// import { CONTRACT_ADDRESS } from './contracts/config';

// // Replace with your actual Pinata JWT token
// const PINATA_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIzYmM4YWVhOS05MzU2LTQwM2UtYTk1MC00NjMzOGE4ZDJkYzYiLCJlbWFpbCI6InNoYXRha3NoaXNodWtsYTQ5QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiIxODZkMjViMzczZjI3NjcyN2JkMSIsInNjb3BlZEtleVNlY3JldCI6ImY3MTc5MzNmYWRiOGRiMjlhZTZhMTM1OGEwZjVhM2ZhMTM0NDRhZGRkYTVhZTE5NzNiYjZhMmU3Yjg1YzM3YzIiLCJleHAiOjE4MjE0NTE2NTV9.RV1WGGHjNHzZsQyJL5LYTP1Z29-XvwZTQLFRudzp5b4";

// function App() {
//   const [account, setAccount] = useState('');
//   const [isConnecting, setIsConnecting] = useState(false);
//   const [errorMessage, setErrorMessage] = useState('');

//   // Form states
//   const [selectedFile, setSelectedFile] = useState(null);
//   const [studentAddress, setStudentAddress] = useState('');
//   const [degreeName, setDegreeName] = useState('');
//   const [fileHash, setFileHash] = useState('');
//   const [ipfsCid, setIpfsCid] = useState('');
//   const [status, setStatus] = useState('');
//   const [isLoading, setIsLoading] = useState(false);

//   const switchToSepolia = async () => {
//     try {
//       await window.ethereum.request({
//         method: 'wallet_switchEthereumChain',
//         params: [{ chainId: '0xaa36a7' }],
//       });
//       return true;
//     } catch (switchError) {
//       if (switchError.code === 4902) {
//         try {
//           await window.ethereum.request({
//             method: 'wallet_addEthereumChain',
//             params: [
//               {
//                 chainId: '0xaa36a7',
//                 chainName: 'Sepolia Test Network',
//                 nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
//                 rpcUrls: ['https://rpc.sepolia.org'],
//                 blockExplorerUrls: ['https://sepolia.etherscan.io'],
//               },
//             ],
//           });
//           return true;
//         } catch (addError) {
//           console.error('Failed to add Sepolia:', addError);
//         }
//       }
//       return false;
//     }
//   };

//   const connectWallet = async () => {
//     if (!window.ethereum) {
//       setErrorMessage('MetaMask is not installed.');
//       return;
//     }

//     try {
//       setIsConnecting(true);
//       setErrorMessage('');

//       const provider = new ethers.BrowserProvider(window.ethereum);
//       const network = await provider.getNetwork();

//       if (Number(network.chainId) !== 11155111) {
//         const switched = await switchToSepolia();
//         if (!switched) {
//           setErrorMessage('Please switch MetaMask network to Sepolia.');
//           setIsConnecting(false);
//           return;
//         }
//       }

//       const accounts = await provider.send('eth_requestAccounts', []);
//       setAccount(accounts[0]);
//     } catch (error) {
//       console.error('Error connecting wallet:', error);
//       setErrorMessage('Failed to connect wallet.');
//     } finally {
//       setIsConnecting(false);
//     }
//   };

//   // 1. Calculate SHA-256 Hash of uploaded document
//   const handleFileChange = async (e) => {
//     const file = e.target.files[0];
//     if (!file) return;

//     setSelectedFile(file);
//     setStatus('Computing cryptographic hash...');

//     const arrayBuffer = await file.arrayBuffer();
//     const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
//     const hashArray = Array.from(new Uint8Array(hashBuffer));
//     const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

//     setFileHash(hashHex);
//     setStatus('Hash calculated successfully!');
//   };

//   // 2. Upload PDF to Pinata IPFS
//   const uploadToIPFS = async () => {
//     if (!selectedFile) throw new Error('No file selected.');

//     const formData = new FormData();
//     formData.append('file', selectedFile);

//     const res = await axios.post(
//       'https://api.pinata.cloud/pinning/pinFileToIPFS',
//       formData,
//       {
//         headers: {
//           'Authorization': `Bearer ${PINATA_JWT}`,
//           'Content-Type': 'multipart/form-data',
//         },
//       }
//     );

//     return res.data.IpfsHash;
//   };

//   // 3. Store Record On-Chain
//   const handleIssueTranscript = async (e) => {
//     e.preventDefault();
//     if (!fileHash || !studentAddress || !selectedFile) {
//       alert('Please fill out student ID/address and select a transcript PDF.');
//       return;
//     }

//     try {
//       setIsLoading(true);
//       setStatus('Uploading transcript document to Pinata IPFS...');

//       // Step A: Upload file to Pinata IPFS
//       const cid = await uploadToIPFS();
//       setIpfsCid(cid);
//       setStatus(`Pinned to IPFS (CID: ${cid}). Prompting wallet transaction...`);

//       // Step B: Connect to Smart Contract via Ethers
//       const provider = new ethers.BrowserProvider(window.ethereum);
//       const signer = await provider.getSigner();
//       const contract = new ethers.Contract(CONTRACT_ADDRESS, AcademicRegistryABI, signer);

//       // Step C: Call issueTranscript with exact 3 arguments from AcademicRegistry.sol
//       // Parameters: (_studentId, _hash, _ipfsCID)
//       const tx = await contract.issueTranscript(
//         studentAddress, // Passed as _studentId
//         fileHash,       // Passed as _hash
//         cid             // Passed as _ipfsCID
//       );

//       setStatus(`Transaction submitted! Hash: ${tx.hash}. Awaiting block confirmation...`);
//       await tx.wait();

//       setStatus('✅ Transcript successfully registered on-chain!');
//     } catch (error) {
//       console.error('Error issuing transcript:', error);
//       setStatus(`❌ Error: ${error.reason || error.message || 'Transaction failed.'}`);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '650px', margin: '0 auto' }}>
//       <h1>VaultScript Admin Portal</h1>
//       <p>Decentralized Academic Transcript Verification System</p>

//       {/* Display error messages if wallet is disconnected or on wrong network */}
//       {errorMessage && (
//         <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', border: '1px solid red', borderRadius: '4px' }}>
//           {errorMessage}
//         </div>
//       )}

//       {/* Wallet Connection Toggle */}
//       {!account ? (
//         <button
//           onClick={connectWallet}
//           disabled={isConnecting}
//           style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer' }}
//         >
//           {isConnecting ? 'Connecting...' : 'Connect MetaMask Wallet'}
//         </button>
//       ) : (
//         <div>
//           <div style={{ padding: '1rem', background: '#f4f4f4', borderRadius: '8px', marginBottom: '1.5rem' }}>
//             <h3 style={{ color: 'green', margin: 0 }}>✓ University Admin Connected</h3>
//             <p style={{ margin: '0.5rem 0 0 0' }}><strong>Address:</strong> {account}</p>
//           </div>

//           {/* --- YOUR FORM STARTS HERE --- */}
//           <form onSubmit={handleIssueTranscript} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
//             <div>
//               <label><strong>Student ID or Address:</strong></label>
//               <input
//                 type="text"
//                 placeholder="STU-12345 or 0x..."
//                 value={studentAddress}
//                 onChange={(e) => setStudentAddress(e.target.value)}
//                 style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
//                 required
//               />
//             </div>

//             <div>
//               <label><strong>Select Transcript Document (PDF):</strong></label>
//               <input
//                 type="file"
//                 accept="application/pdf"
//                 onChange={handleFileChange}
//                 style={{ width: '100%', marginTop: '0.25rem' }}
//                 required
//               />
//             </div>

//             {fileHash && (
//               <div style={{ fontSize: '0.85rem', background: '#eef', padding: '0.5rem', borderRadius: '4px', wordBreak: 'break-all' }}>
//                 <strong>Computed SHA-256 Hash:</strong> {fileHash}
//               </div>
//             )}

//             <button
//               type="submit"
//               disabled={isLoading}
//               style={{ padding: '0.75rem', fontSize: '1rem', cursor: 'pointer', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px' }}
//             >
//               {isLoading ? 'Processing...' : 'Issue Transcript On-Chain'}
//             </button>
//           </form>
//           {/* --- YOUR FORM ENDS HERE --- */}

//           {/* Live Transaction & IPFS Feedback */}
//           {status && (
//             <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '4px' }}>
//               <strong>Status:</strong> {status}
//               {ipfsCid && (
//                 <p style={{ margin: '0.5rem 0 0 0', wordBreak: 'break-all' }}>
//                   <strong>IPFS Gateway Link:</strong>{' '}
//                   <a href={`https://gateway.pinata.cloud/ipfs/${ipfsCid}`} target="_blank" rel="noreferrer">
//                     View Document on IPFS
//                   </a>
//                 </p>
//               )}
//             </div>
//           )}
//         </div>
//       )}
//     </div>
//   );
// }

// export default App;