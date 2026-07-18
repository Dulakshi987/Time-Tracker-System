package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

// Feeds the "Checked By" dropdown in the Check Portal — same shape/UI as Picker.
@Entity
@Table(name = "check_operator")
@Data
public class CheckOperator {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "operator_name")
    private String operatorName;

    @Column(name = "nic")
    private String nic;

    @Column(name = "operator_nic_name")
    private String operatorNicName;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface CheckOperatorRepository extends JpaRepository<CheckOperator, Long> {}