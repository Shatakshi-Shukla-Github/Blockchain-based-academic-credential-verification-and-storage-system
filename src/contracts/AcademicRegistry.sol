// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AcademicRegistry {
    address public owner;

    struct Transcript {
        string studentId;
        string sha256Hash;
        string ipfsCID;
        address issuingUniversity;
        uint256 timestamp;
    }

    // Mapping from university wallet to University Name
    mapping(address => string) public authorizedUniversities;

    // Mapping from SHA-256 Hash to Transcript Record
    mapping(string => Transcript) private registry;

    event UniversityAuthorized(address indexed uniWallet, string uniName);
    event TranscriptIssued(string indexed sha256Hash, address indexed issuingUniversity, string studentId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner can perform this action");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // Owner registers authorized university wallets
    function authorizeUniversity(address _uniWallet, string memory _uniName) external onlyOwner {
        require(_uniWallet != address(0), "Invalid wallet address");
        authorizedUniversities[_uniWallet] = _uniName;
        emit UniversityAuthorized(_uniWallet, _uniName);
    }

    // Authorized university issues a transcript
    function issueTranscript(string memory _studentId, string memory _hash, string memory _ipfsCID) external {
        require(bytes(authorizedUniversities[msg.sender]).length > 0, "Unauthorized university wallet");
        require(registry[_hash].timestamp == 0, "Transcript already registered on-chain");

        registry[_hash] = Transcript(_studentId, _hash, _ipfsCID, msg.sender, block.timestamp);
        emit TranscriptIssued(_hash, msg.sender, _studentId);
    }

    // Public read function to verify a transcript by hash
    function verifyTranscript(string memory _hash) external view returns (
        bool isValid,
        string memory studentId,
        string memory ipfsCID,
        string memory universityName,
        uint256 timestamp
    ) {
        Transcript memory t = registry[_hash];
        if (t.timestamp == 0) {
            return (false, "", "", "", 0);
        }
        return (true, t.studentId, t.ipfsCID, authorizedUniversities[t.issuingUniversity], t.timestamp);
    }
}