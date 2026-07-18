package com.repository;

import com.entity.FileNumberSetup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface FileNumberSetupRepository extends JpaRepository<FileNumberSetup, Long> {
}