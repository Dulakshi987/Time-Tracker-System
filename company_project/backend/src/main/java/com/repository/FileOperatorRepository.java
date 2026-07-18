package com.repository;

import com.entity.FileOperator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface FileOperatorRepository extends JpaRepository<FileOperator, Long> {
}