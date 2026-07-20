package com.controller;

import com.entity.SystemUser;
import com.service.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

// Login endpoint for accounts created in Master Setup → User Accounts
// (SystemUser). Frontend: Login.jsx (AUTH_API + "/login").
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    @Autowired
    private AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Username and password are required."));
        }

        SystemUser user = authService.login(username, password);

        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("message", "Invalid username or password."));
        }

        // Never return the password hash to the client.
        Map<String, Object> response = new HashMap<>();
        response.put("id", user.getId());
        response.put("staffName", user.getStaffName());
        response.put("fullName", user.getFullName());
        response.put("username", user.getUsername());

        return ResponseEntity.ok(response);
    }
} 