package com.service;

import com.entity.SystemUser;
import com.repository.SystemUserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Service
public class AuthService {

    @Autowired
    private SystemUserRepository systemUserRepository;

    /**
     * Returns the matching SystemUser if the username/password pair is valid,
     * or null otherwise. Password is hashed with SHA-256 the same way it was
     * hashed when the account was created in Master Setup → User Accounts
     * (AdminSetupService) — keep both hash() implementations identical.
     */
    public SystemUser login(String username, String password) {
        if (username == null || password == null) return null;

        SystemUser user = systemUserRepository.findByUsername(username.trim());
        if (user == null || user.getPasswordHash() == null) return null;

        String candidateHash = hash(password);
        if (candidateHash.equals(user.getPasswordHash())) {
            return user;
        }
        return null;
    }

    public static String hash(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}