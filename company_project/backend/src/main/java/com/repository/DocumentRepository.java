package com.repository;

import com.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface DocumentRepository extends JpaRepository<Document, Long> {

    List<Document> findByJobType(String jobType);

    @Query("SELECT d FROM Document d "
         + "WHERE (:fromDate IS NULL OR d.requestDate >= :fromDate) "
         + "AND (:toDate IS NULL OR d.requestDate <= :toDate)")
    List<Document> findByDateRange(
            @Param("fromDate") String fromDate,
            @Param("toDate") String toDate
    );
}