package com.controller;

import com.entity.SystemUser;
import com.service.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
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
        response.put("staffName", user.getStaffName()); // used by the frontend as the ROLE key
        response.put("fullName", user.getFullName());
        response.put("username", user.getUsername());

        // ── Division-wise access ────────────────────────────────────────
        // SystemUser stores this as a single comma-separated column:
        //   @Column(name = "division_no") private String divisionNo;
        //   e.g. "4017,4032,4026"
        // The frontend needs it as a List<String> so it can filter
        // cards/rows by comparing each document's divisionNo against this
        // list (Admin / System Administrator skip this check and see
        // everything — see hasAllDivisionAccess() in permissions.js).
        List<String> divisionNumbers = user.getDivisionNo() == null
                ? List.of()
                : Arrays.stream(user.getDivisionNo().split(","))
                        .map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .toList();
        response.put("divisions", divisionNumbers);

        return ResponseEntity.ok(response);
    }
}