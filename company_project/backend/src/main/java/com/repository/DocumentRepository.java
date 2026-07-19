package com.repository;

import com.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface DocumentRepository extends JpaRepository<Document, Long> {

    List<Document> findByJobType(String jobType);

    // requestDate is stored as a plain "yyyy-MM-dd" string (see entity),
    // so a string BETWEEN works fine and keeps this in line with the
    // rest of the codebase's date-as-string convention.
    @Query("SELECT d FROM Document d WHERE d.requestDate BETWEEN :fromDate AND :toDate")
    List<Document> findByDateRange(@Param("fromDate") String fromDate, @Param("toDate") String toDate);
}