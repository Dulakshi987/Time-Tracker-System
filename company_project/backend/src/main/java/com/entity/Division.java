package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

@Entity
@Table(name = "division")
@Data
public class Division {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "division_name")
    private String divisionName;

    @Column(name = "division_no")
    private String divisionNo;

    @Column(name = "division_head")
    private String divisionHead;

    @Column(name = "entered_by")
    private String enteredBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface DivisionRepository extends JpaRepository<Division, Long> {}