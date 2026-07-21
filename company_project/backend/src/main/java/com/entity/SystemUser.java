package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

// Button 2: System user / login account. "staffName" is picked from the
// StaffMember dropdown (Button 1, populated in real time). This is what
// grants API/system access — password is never stored in plain text.
@Entity
@Table(name = "system_user")
@Data
public class SystemUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "staff_name")
    private String staffName;

    @Column(name = "full_name")
    private String fullName;

    @Column(name = "nic")
    private String nic;

    @Column(name = "username", unique = true)
    private String username;

    // SHA-256 hash — see AdminSetupService.hash()
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "division_no")
    private String divisionNo;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface SystemUserRepository extends JpaRepository<SystemUser, Long> {
    SystemUser findByUsername(String username);
    SystemUser findByUsernameAndNic(String username, String nic);
}
