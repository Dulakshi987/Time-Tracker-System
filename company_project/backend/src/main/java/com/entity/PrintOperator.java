package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

// Names entered here feed the "Printed By" / document-entering dropdowns
// used in the Document & Print Portal — same shape/UI as Picker.
@Entity
@Table(name = "print_operator")
@Data
public class PrintOperator {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "operator_name")
    private String operatorName;

    @Column(name = "nic")
    private String nic;

    @Column(name = "operator_nic_name")
    private String operatorNicName;

    @Column(name = "division_no")
    private String divisionNo;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface PrintOperatorRepository extends JpaRepository<PrintOperator, Long> {}