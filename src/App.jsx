import { useState } from 'react';
import { ethers } from 'ethers';
import AcademicRegistryABI from './contracts/AcademicRegistryABI.json';
import { CONTRACT_ADDRESS } from './contracts/config';

function App() {
  const [account, setAccount] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Helper function to switch MetaMask to Sepolia automatically
  const switchToSepolia = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }], // 0xaa36a7 is Hex for Sepolia (11155111)
      });
      return true;
    } catch (switchError) {
      // If Sepolia isn't added to MetaMask, prompt to add it
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
          console.error('Failed to add Sepolia network:', addError);
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

      // Check current network
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== 11155111) {
        const switched = await switchToSepolia();
        if (!switched) {
          setErrorMessage('Please manually switch MetaMask network to Sepolia.');
          setIsConnecting(false);
          return;
        }
      }

      // Request accounts after verifying/switching network
      const accounts = await provider.send('eth_requestAccounts', []);
      setAccount(accounts[0]);
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setErrorMessage('Failed to connect wallet.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1>VaultScript Admin Portal</h1>
      <p>Decentralized Academic Transcript Verification System</p>

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', border: '1px solid red', borderRadius: '4px' }}>
          {errorMessage}
        </div>
      )}

      {!account ? (
        <button
          onClick={connectWallet}
          disabled={isConnecting}
          style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer' }}
        >
          {isConnecting ? 'Connecting...' : 'Connect MetaMask Wallet'}
        </button>
      ) : (
        <div style={{ padding: '1rem', background: '#f4f4f4', borderRadius: '8px' }}>
          <h3 style={{ color: 'green' }}>✓ Wallet Connected</h3>
          <p><strong>Address:</strong> {account}</p>
          <p><strong>Contract Address:</strong> {CONTRACT_ADDRESS}</p>
        </div>
      )}
    </div>
  );
}

export default App;