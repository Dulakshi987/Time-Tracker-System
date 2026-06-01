package com.repository;

import com.entity.IssuePrint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface IssuePrintRepository extends JpaRepository<IssuePrint, Long> {
}