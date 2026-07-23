package com.controller;

import com.entity.PrintOperator;
import com.repository.PrintOperatorRepository;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/print-operators")
@CrossOrigin(origins = "https://logitrack-warehouse-system.netlify.app/")
public class PrintOperatorController {

    @Autowired
    private PrintOperatorRepository repository;

    // Entered By dropdown calls this the moment a Division is selected —
    // returns ONLY the NIC names belonging to that division.
    @GetMapping("/by-division/{divisionNo}")
    public List<PrintOperator> getByDivision(@PathVariable String divisionNo) {
        return repository.findByDivisionNo(divisionNo);
    }
}