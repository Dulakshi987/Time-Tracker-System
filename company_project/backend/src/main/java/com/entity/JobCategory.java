package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

// "divisionName" is chosen from the Division dropdown (created under the
// Division button) — the job category is saved against that division.
@Entity
@Table(name = "job_category")
@Data
public class JobCategory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "category_name")
    private String categoryName;

    @Column(name = "division_name")
    private String divisionName;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface JobCategoryRepository extends JpaRepository<JobCategory, Long> {}